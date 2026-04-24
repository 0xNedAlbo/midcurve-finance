/**
 * Vault Position Conversion Summary Endpoint
 *
 * GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/conversion
 *
 * Same as the NFT /conversion endpoint, but adapts the vault-specific event
 * types to the NFT-ledger shape before running the shared conversion math.
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  GetUniswapV3VaultPositionParamsSchema,
} from '@midcurve/api-shared';
import type { ConversionSummaryResponse } from '@midcurve/api-shared';
import {
  computeUniswapV3ConversionSummary,
  serializeConversionSummary,
  adaptVaultEventsForConversion,
  type ConversionPositionInput,
  type VaultLedgerEventInput,
} from '@midcurve/shared';
import { serializeUniswapV3VaultPosition } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  getUniswapV3VaultPositionService,
  getUniswapV3VaultLedgerService,
} from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ chainId: string; vaultAddress: string; ownerAddress: string }>;
  },
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const resolvedParams = await params;
      const validation = GetUniswapV3VaultPositionParamsSchema.safeParse(resolvedParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          validation.error.errors,
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId, vaultAddress, ownerAddress } = validation.data;
      const positionHash = `uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}`;

      const dbPosition = await getUniswapV3VaultPositionService().findByPositionHash(
        user.id,
        positionHash,
      );

      if (!dbPosition) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Vault position not found',
          `No vault position found for chainId ${chainId} and vaultAddress ${vaultAddress}`,
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      const ledgerEvents = await getUniswapV3VaultLedgerService(dbPosition.id).findAll();

      const serializedVault = serializeUniswapV3VaultPosition(dbPosition);
      const serializedEvents = ledgerEvents.map(
        (e: { toJSON: () => unknown }) => e.toJSON(),
      ) as unknown as VaultLedgerEventInput[];

      // Map the vault position into the NFT-shaped input: sharesBalance is the
      // user's proportional liquidity since totalSupply == underlying NFT liquidity.
      const conversionPosition: ConversionPositionInput = {
        isToken0Quote: serializedVault.isToken0Quote,
        positionOpenedAt: serializedVault.positionOpenedAt,
        archivedAt: serializedVault.archivedAt,
        config: {
          tickLower: serializedVault.config.tickLower,
          tickUpper: serializedVault.config.tickUpper,
        },
        state: {
          liquidity: serializedVault.state.sharesBalance,
          unclaimedFees0: serializedVault.state.unclaimedFees0,
          unclaimedFees1: serializedVault.state.unclaimedFees1,
        },
        pool: {
          token0: {
            symbol: serializedVault.pool.token0.symbol,
            decimals: serializedVault.pool.token0.decimals,
          },
          token1: {
            symbol: serializedVault.pool.token1.symbol,
            decimals: serializedVault.pool.token1.decimals,
          },
          state: {
            sqrtPriceX96: serializedVault.pool.state.sqrtPriceX96,
          },
        },
      };

      const adaptedEvents = adaptVaultEventsForConversion(serializedEvents);
      const summary = computeUniswapV3ConversionSummary(conversionPosition, adaptedEvents);

      const response: ConversionSummaryResponse = {
        ...createSuccessResponse(serializeConversionSummary(summary)),
        meta: { timestamp: new Date().toISOString(), requestId },
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/conversion',
        error,
        { requestId },
      );

      if (error instanceof Error) {
        if (
          error.message.includes('not found') ||
          error.message.includes('does not exist')
        ) {
          const errorResponse = createErrorResponse(
            ApiErrorCode.POSITION_NOT_FOUND,
            'Position not found',
            error.message,
          );
          apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
          return NextResponse.json(errorResponse, {
            status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
          });
        }
      }

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to compute vault position conversion summary',
        error instanceof Error ? error.message : String(error),
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
