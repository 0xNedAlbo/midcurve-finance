/**
 * Vault Prepare Endpoint
 *
 * GET /api/v1/strategies/:id/vault/prepare
 *
 * Authentication: Required (session only)
 *
 * Returns all parameters needed to deploy a SimpleTokenVault contract from the user's wallet.
 * This endpoint should be called after strategy deployment is complete (automation wallet exists).
 *
 * Prerequisites:
 * - Strategy must exist and belong to the authenticated user
 * - Strategy must have a manifest with fundingToken defined
 * - Strategy must be deployed (has automation wallet)
 *
 * Response (200):
 * {
 *   success: true,
 *   data: {
 *     strategyId: string,
 *     vaultChainId: number,           // From manifest.fundingToken.chainId
 *     vaultToken: { address, symbol, decimals },
 *     constructorParams: { owner, operator, token },
 *     bytecode: string                // 0x-prefixed hex bytecode
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import {
  createErrorResponse,
  createSuccessResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import type { PrepareVaultDeploymentData } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { Erc20TokenService } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manifest fundingToken structure
 */
interface FundingTokenSpec {
  type: 'erc20';
  chainId: number;
  address: string;
}

/**
 * EVM automation wallet config structure
 */
interface EvmWalletConfig {
  strategyAddress?: string;
  walletAddress: string;
  kmsKeyId?: string;
  keyProvider?: string;
}

/**
 * EVM service vault contract response
 */
interface VaultContractResponse {
  bytecode: string;
  abi: unknown[];
}

/**
 * OPTIONS /api/v1/strategies/:id/vault/prepare
 *
 * CORS preflight handler
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/strategies/:id/vault/prepare
 *
 * Get vault deployment parameters for a strategy.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const { id } = await params;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'prepare',
        'vault-deployment',
        user.id,
        { strategyId: id }
      );

      // 1. Get strategy with manifest and automation wallets
      const strategy = await prisma.strategy.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          status: true,
          manifest: true,
          vaultConfig: true,
          automationWallets: {
            where: { walletType: 'evm', isActive: true },
            select: { config: true },
            take: 1,
          },
        },
      });

      if (!strategy) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.STRATEGY_NOT_FOUND,
          'Strategy not found'
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.STRATEGY_NOT_FOUND],
        });
      }

      // 2. Authorization check
      if (strategy.userId !== user.id) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.FORBIDDEN,
          'You do not have permission to access this strategy'
        );
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.FORBIDDEN],
        });
      }

      // 3. Check if vault is already deployed
      if (strategy.vaultConfig) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Vault is already deployed for this strategy'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 4. Validate manifest has fundingToken with required fields
      const manifest = strategy.manifest as { fundingToken?: FundingTokenSpec } | null;
      if (!manifest?.fundingToken) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Strategy manifest does not have a fundingToken defined'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { fundingToken } = manifest;

      // Validate fundingToken has required address field
      if (!fundingToken.address || !fundingToken.chainId) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Strategy manifest fundingToken is missing required fields (address or chainId). Please redeploy with an updated manifest.'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 5. Check strategy is deployed (has automation wallet)
      if (strategy.automationWallets.length === 0) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Strategy must be deployed before vault can be created. No automation wallet found.'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const walletConfig = strategy.automationWallets[0].config as unknown as EvmWalletConfig;
      const operatorAddress = walletConfig.walletAddress;

      if (!operatorAddress) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Automation wallet address not found in config'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
        });
      }

      // 6. Get user's primary wallet address (vault owner)
      const primaryWallet = user.wallets?.find((w) => w.isPrimary);
      const ownerAddress = primaryWallet?.address || user.wallets?.[0]?.address;

      if (!ownerAddress) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'User must have a linked wallet to deploy a vault'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 7. Fetch vault contract bytecode from EVM service
      const evmServiceUrl = process.env.EVM_SERVICE_URL || 'http://localhost:3002';

      let vaultContract: VaultContractResponse;
      try {
        const response = await fetch(`${evmServiceUrl}/api/contracts/vault`);
        if (!response.ok) {
          throw new Error(`EVM service returned ${response.status}`);
        }
        vaultContract = await response.json() as VaultContractResponse;
      } catch (error) {
        apiLogger.error({
          requestId,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Failed to fetch vault contract from EVM service',
        });
        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to fetch vault contract bytecode',
          error instanceof Error ? error.message : String(error)
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
        });
      }

      // 8. Get token info for the funding token (discover() fetches from chain if not in DB)
      let tokenSymbol = 'UNKNOWN';
      let tokenDecimals = 18;

      try {
        const tokenService = new Erc20TokenService();
        // Use discover() instead of findByAddress() to auto-create token if not in DB
        const token = await tokenService.discover({
          chainId: fundingToken.chainId,
          address: fundingToken.address,
        });
        if (token) {
          tokenSymbol = token.symbol;
          tokenDecimals = token.decimals;
        }
      } catch (error) {
        // Log but don't fail - symbol is optional
        apiLogger.warn({
          requestId,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Failed to discover funding token details',
        });
      }

      // 9. Build response
      const responseData: PrepareVaultDeploymentData = {
        strategyId: strategy.id,
        vaultChainId: fundingToken.chainId,
        vaultToken: {
          address: fundingToken.address,
          symbol: tokenSymbol,
          decimals: tokenDecimals,
        },
        constructorParams: {
          owner: ownerAddress,
          operator: operatorAddress,
          token: fundingToken.address,
        },
        bytecode: vaultContract.bytecode,
      };

      apiLogger.info({
        requestId,
        strategyId: id,
        vaultChainId: fundingToken.chainId,
        owner: ownerAddress,
        operator: operatorAddress,
        msg: 'Vault deployment prepared',
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(responseData));
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/strategies/:id/vault/prepare',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to prepare vault deployment',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
