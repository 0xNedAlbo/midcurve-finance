/**
 * Open Hyperliquid Hedge Endpoint
 *
 * POST /api/v1/hedges/hyperliquid/open
 *
 * Opens a hedge position on Hyperliquid using the user's stored API wallet.
 * All signing happens on the backend - no wallet interaction required from the user.
 *
 * Flow:
 * 1. Authenticate user (session only)
 * 2. Get user's active API wallet
 * 3. Execute hedge opening:
 *    a. Prepare subaccount (find unused OR create new)
 *    b. Rename to "mc-{positionHash}"
 *    c. Transfer USD margin
 *    d. Place IOC limit order
 *    e. Poll for fill
 * 4. On error: Rollback (rename subaccount to "unused-{n}")
 *
 * Authentication: Session only (no API keys - this is a sensitive operation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { HttpTransport } from '@nktkas/hyperliquid';
import {
  subAccountModify,
  subAccountTransfer,
  order,
} from '@nktkas/hyperliquid/api/exchange';
import {
  subAccounts,
  clearinghouseState,
  orderStatus,
  metaAndAssetCtxs,
} from '@nktkas/hyperliquid/api/info';
import type { LocalAccount } from 'viem/accounts';

import { withAuth } from '@/middleware/with-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  OpenHyperliquidHedgeRequestSchema,
  type OpenHyperliquidHedgeResponse,
  type OpenHedgeErrorCode,
} from '@midcurve/api-shared';
import {
  HyperliquidApiWalletService,
  HyperliquidClient,
  isUnusedSubaccountName,
  generateSubaccountName,
} from '@midcurve/services';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Configuration
const MARGIN_BUFFER = 1.02; // 2% buffer on margin
const POLL_TIMEOUT_MS = 30000; // 30 seconds
const POLL_FAST_INTERVAL_MS = 500;
const POLL_NORMAL_INTERVAL_MS = 1000;
const POLL_FAST_PHASE_MS = 5000;

/**
 * Helper to create error response with hedge-specific error code
 */
function createHedgeError(
  code: OpenHedgeErrorCode,
  message: string,
  details?: Record<string, unknown>
) {
  return createErrorResponse(ApiErrorCode.HEDGE_OPEN_ERROR, message, {
    code,
    ...details,
  });
}

/**
 * Helper to delay execution
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST /api/v1/hedges/hyperliquid/open
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    // State tracking for rollback
    let subaccountAddress: `0x${string}` | null = null;
    let subaccountPrepared = false;
    let marginTransferred: string | null = null;
    let localAccount: LocalAccount | null = null;
    let transport: HttpTransport | null = null;

    try {
      // Parse and validate request body
      const body = await request.json();
      const validation = OpenHyperliquidHedgeRequestSchema.safeParse(body);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        return NextResponse.json(
          createErrorResponse(
            ApiErrorCode.VALIDATION_ERROR,
            'Invalid request body',
            validation.error.errors
          ),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] }
        );
      }

      const params = validation.data;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'open-hedge',
        'hedge',
        params.positionHash,
        { userId: user.id, coin: params.coin, leverage: params.leverage }
      );

      // Get user's active API wallet
      const walletService = new HyperliquidApiWalletService();
      const wallets = await walletService.listWallets(user.id, 'mainnet');
      const activeWallet = wallets.find(
        (w) => w.isActive && new Date(w.expiresAt) > new Date()
      );

      if (!activeWallet) {
        const expiredWallet = wallets.find((w) => w.isActive);
        if (expiredWallet) {
          apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
          return NextResponse.json(
            createHedgeError(
              'WALLET_EXPIRED',
              'Your Hyperliquid API wallet has expired. Please renew it in Settings.'
            ),
            { status: 400 }
          );
        }
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(
          createHedgeError(
            'NO_API_WALLET',
            'No Hyperliquid API wallet found. Please add one in Settings.'
          ),
          { status: 400 }
        );
      }

      // Get LocalAccount for signing
      localAccount = await walletService.getLocalAccount(
        user.id,
        activeWallet.walletAddress,
        'mainnet'
      );

      // Initialize transport
      transport = new HttpTransport({
        isTestnet: false,
        fetchOptions: { keepalive: false },
      });

      const hlClient = new HyperliquidClient({ environment: 'mainnet' });

      // Step 1: Check main account balance
      const mainState = await clearinghouseState(
        { transport },
        { user: activeWallet.walletAddress as `0x${string}` }
      );
      const availableBalance = parseFloat(mainState.withdrawable);
      const requiredMargin =
        (parseFloat(params.notionalValueUsd) / params.leverage) * MARGIN_BUFFER;

      if (availableBalance < requiredMargin) {
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(
          createHedgeError(
            'INSUFFICIENT_BALANCE',
            `Insufficient balance: need $${requiredMargin.toFixed(2)} but only have $${availableBalance.toFixed(2)} available`,
            {
              required: requiredMargin.toFixed(2),
              available: availableBalance.toFixed(2),
            }
          ),
          { status: 400 }
        );
      }

      // Step 2: Prepare subaccount (find unused or create new)
      const subaccountName = generateSubaccountName(params.positionHash);

      // Check for unused subaccounts
      const allSubaccounts = await subAccounts(
        { transport },
        { user: activeWallet.walletAddress as `0x${string}` }
      );
      const unusedSubaccounts = (allSubaccounts ?? []).filter((s) =>
        isUnusedSubaccountName(s.name)
      );

      if (unusedSubaccounts.length > 0) {
        // Reuse first unused subaccount
        const toReuse = unusedSubaccounts[0]!;
        subaccountAddress = toReuse.subAccountUser;

        // Rename to active name
        await subAccountModify(
          { transport, wallet: localAccount },
          { subAccountUser: subaccountAddress, name: subaccountName }
        );
      } else {
        // Create new subaccount
        const result = await hlClient.createSubAccount(
          localAccount,
          subaccountName
        );
        subaccountAddress = result.address;
      }

      subaccountPrepared = true;
      apiLogger.info(
        { subaccountAddress, subaccountName },
        'Subaccount prepared'
      );

      // Step 3: Transfer USD margin
      const marginStr = requiredMargin.toFixed(2);
      const usdMicro = Math.round(requiredMargin * 1e6);

      await subAccountTransfer(
        { transport, wallet: localAccount },
        {
          subAccountUser: subaccountAddress,
          isDeposit: true,
          usd: usdMicro,
        }
      );

      marginTransferred = marginStr;
      apiLogger.info({ marginTransferred }, 'Margin transferred');

      // Step 4: Place order
      // Get asset index for the coin
      const rawData = await metaAndAssetCtxs({ transport });
      const coinIndex = rawData[0].universe.findIndex(
        (u) => u.name === params.coin
      );

      if (coinIndex === -1) {
        throw new Error(`Market not found for ${params.coin}`);
      }

      // Use aggressive price for short: 1% below mark price
      const aggressivePrice = (parseFloat(params.markPrice) * 0.99).toFixed(2);

      const orderResult = await order(
        { transport, wallet: localAccount },
        {
          orders: [
            {
              a: coinIndex,
              b: false, // Short position
              p: aggressivePrice,
              s: params.hedgeSize,
              r: false, // Not reduce-only
              t: { limit: { tif: 'Ioc' } }, // Immediate-or-Cancel
            },
          ],
          grouping: 'na',
        },
        { vaultAddress: subaccountAddress }
      );

      const status = orderResult.response.data.statuses[0];

      if (!status) {
        throw new Error('No order status returned');
      }

      if ('error' in status) {
        throw new Error(`Order rejected: ${status.error}`);
      }

      let orderId: number;
      let fillPrice: string | undefined;
      let fillSize: string | undefined;

      if ('filled' in status) {
        // Immediately filled
        orderId = status.filled.oid;
        fillPrice = status.filled.avgPx;
        fillSize = status.filled.totalSz;
        apiLogger.info({ orderId, fillPrice, fillSize }, 'Order filled');
      } else if ('resting' in status) {
        // Resting order - need to monitor
        orderId = status.resting.oid;

        // Step 5: Monitor order execution
        const pollStartTime = Date.now();

        while (Date.now() - pollStartTime < POLL_TIMEOUT_MS) {
          const statusResult = await orderStatus(
            { transport },
            { user: subaccountAddress, oid: orderId }
          );

          if (statusResult.status === 'order' && statusResult.order) {
            const remainingSize = parseFloat(statusResult.order.order.sz);
            if (remainingSize === 0) {
              // Fully filled
              fillSize = statusResult.order.order.origSz;
              fillPrice = aggressivePrice; // Approximate
              break;
            }
          }

          // Determine poll interval
          const elapsed = Date.now() - pollStartTime;
          const interval =
            elapsed < POLL_FAST_PHASE_MS
              ? POLL_FAST_INTERVAL_MS
              : POLL_NORMAL_INTERVAL_MS;

          await delay(interval);
        }

        // Timeout - check position state as fallback
        if (!fillSize) {
          const subState = await clearinghouseState(
            { transport },
            { user: subaccountAddress }
          );
          const position = subState.assetPositions.find(
            (ap) => ap.position.coin === params.coin
          );

          if (position && parseFloat(position.position.szi) !== 0) {
            fillSize = Math.abs(parseFloat(position.position.szi)).toString();
            fillPrice = position.position.entryPx;
          } else {
            throw new Error(
              'Order did not fill within 30 seconds. Please check Hyperliquid manually.'
            );
          }
        }
      } else {
        throw new Error('Unknown order status');
      }

      // Ensure fill data is present (should always be true if we reach here)
      if (!fillPrice || !fillSize) {
        throw new Error('Order fill data not available');
      }

      // Success!
      const response: OpenHyperliquidHedgeResponse = {
        subaccountAddress,
        subaccountName,
        orderId,
        fillPrice,
        fillSize,
        marginTransferred: marginStr,
        market: `${params.coin}-USD`,
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(
        createSuccessResponse(response, {
          requestId,
          timestamp: new Date().toISOString(),
        }),
        { status: 200 }
      );
    } catch (error) {
      // Attempt rollback if subaccount was prepared
      if (subaccountPrepared && subaccountAddress && localAccount && transport) {
        try {
          apiLogger.info(
            { subaccountAddress },
            'Attempting rollback after error'
          );

          // Count existing unused subaccounts to generate next name
          const allSubaccounts = await subAccounts(
            { transport },
            { user: localAccount.address }
          );
          const unusedCount = (allSubaccounts ?? []).filter((s) =>
            isUnusedSubaccountName(s.name)
          ).length;

          // Rename to unused
          await subAccountModify(
            { transport, wallet: localAccount },
            {
              subAccountUser: subaccountAddress,
              name: `unused-${unusedCount + 1}`,
            }
          );

          // Transfer USD back if it was deposited
          if (marginTransferred) {
            const usdMicro = Math.round(parseFloat(marginTransferred) * 1e6);
            await subAccountTransfer(
              { transport, wallet: localAccount },
              {
                subAccountUser: subaccountAddress,
                isDeposit: false,
                usd: usdMicro,
              }
            );
          }

          apiLogger.info({ subaccountAddress }, 'Rollback completed');
        } catch (rollbackError) {
          apiLogger.error(
            {
              subaccountAddress,
              error:
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError),
            },
            'Rollback failed'
          );
        }
      }

      apiLog.methodError(
        apiLogger,
        'POST /api/v1/hedges/hyperliquid/open',
        error,
        { requestId }
      );

      const message =
        error instanceof Error ? error.message : 'Failed to open hedge';

      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

      return NextResponse.json(
        createHedgeError('HEDGE_OPEN_ERROR', message),
        { status: 500 }
      );
    }
  });
}
