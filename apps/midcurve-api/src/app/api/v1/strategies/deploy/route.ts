/**
 * Strategy Deployment Endpoint
 *
 * POST /api/v1/strategies/deploy
 *
 * Authentication: Required (session only)
 *
 * This endpoint orchestrates strategy deployment by:
 * 1. Validating the manifest (re-verify for security)
 * 2. Resolving the quote token
 * 3. Storing deployment request in CACHE (not database - Strategy created on success)
 * 4. Calling the EVM service to initiate deployment (async)
 * 5. Returning 202 Accepted with deployment status and poll URL
 *
 * NOTE: Strategy record is NOT created until deployment succeeds.
 * This prevents orphan "deploying" strategies from failed deployments.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

import {
  createErrorResponse,
  createSuccessResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  DeployStrategyRequestSchema,
} from '@midcurve/api-shared';
import type {
  DeployStrategyResponse,
  DeploymentInfo,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import {
  ManifestVerificationService,
  BasicCurrencyTokenService,
  Erc20TokenService,
  CacheService,
} from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deployment state stored in cache
 * This data is used by EVM service and to create Strategy on success
 */
interface DeploymentCacheData {
  deploymentId: string;
  status: 'pending';
  startedAt: string;
  // Data needed to create Strategy after successful deployment
  manifest: unknown;
  name: string;
  userId: string;
  quoteTokenId: string;
  constructorValues: Record<string, string>;
  ownerAddress: string;
  // Chain config (fetched from EVM service)
  coreAddress: string;
}

/**
 * EVM config response type
 */
interface EvmConfigResponse {
  coreAddress: string;
  chainId: number;
}

/**
 * TTL for deployment cache entries: 24 hours
 */
const DEPLOYMENT_TTL_SECONDS = 24 * 60 * 60;

/**
 * OPTIONS /api/v1/strategies/deploy
 *
 * CORS preflight handler
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/strategies/deploy
 *
 * Deploy a strategy from an uploaded manifest.
 *
 * Request body:
 * - manifest: Full strategy manifest (ABI, bytecode, constructorParams, quoteToken)
 * - name: User's name for this strategy instance
 * - constructorValues: Values for user-input constructor parameters
 *
 * The quoteToken is resolved from the manifest during deployment:
 * - basic-currency: Validated against CoinGecko and created if not exists
 * - erc20: Discovered from chain and symbol validated (case-sensitive)
 *
 * Returns: Deployment info with poll URL (Strategy created after success)
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate request body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const validation = DeployStrategyRequestSchema.safeParse(body);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { manifest, name, constructorValues } = validation.data;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'deploy',
        'strategy',
        user.id,
        {
          manifestName: manifest.name,
          manifestVersion: manifest.version,
          name,
          hasConstructorValues: Object.keys(constructorValues).length > 0,
          quoteTokenType: manifest.quoteToken?.type,
        }
      );

      // 2. Re-verify manifest for security (don't trust client-side validation)
      const verificationService = new ManifestVerificationService();
      const verificationResult = verificationService.verify(manifest);

      if (!verificationResult.valid) {
        apiLog.businessOperation(
          apiLogger,
          requestId,
          'invalid-manifest',
          'strategy',
          user.id,
          { errors: verificationResult.errors }
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Manifest validation failed',
          verificationResult.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 3. Resolve quote token from manifest
      const quoteToken = verificationResult.parsedManifest!.quoteToken;
      let resolvedQuoteTokenId: string;

      try {
        if (quoteToken.type === 'basic-currency') {
          const basicCurrencyService = new BasicCurrencyTokenService();
          const token = await basicCurrencyService.findOrCreateBySymbol(quoteToken.symbol);
          resolvedQuoteTokenId = token.id;

          apiLogger.info(
            {
              requestId,
              quoteTokenType: 'basic-currency',
              symbol: quoteToken.symbol,
              tokenId: token.id,
            },
            'Resolved basic currency quote token'
          );
        } else {
          const erc20Service = new Erc20TokenService();
          const token = await erc20Service.discover({
            chainId: quoteToken.chainId,
            address: quoteToken.address,
          });

          if (token.symbol !== quoteToken.symbol) {
            const errorResponse = createErrorResponse(
              ApiErrorCode.VALIDATION_ERROR,
              `Quote token symbol mismatch: manifest has "${quoteToken.symbol}" but on-chain is "${token.symbol}"`,
              {
                manifestSymbol: quoteToken.symbol,
                onChainSymbol: token.symbol,
                chainId: quoteToken.chainId,
                address: quoteToken.address,
              }
            );
            apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
            return NextResponse.json(errorResponse, {
              status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
            });
          }

          resolvedQuoteTokenId = token.id;

          apiLogger.info(
            {
              requestId,
              quoteTokenType: 'erc20',
              symbol: quoteToken.symbol,
              chainId: quoteToken.chainId,
              address: quoteToken.address,
              tokenId: token.id,
            },
            'Resolved ERC-20 quote token'
          );
        }
      } catch (error) {
        apiLogger.error(
          {
            requestId,
            quoteToken,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to resolve quote token'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Failed to resolve quote token: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { quoteToken }
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 4. Get user's primary wallet address (for owner parameter)
      const primaryWallet = user.wallets?.find((w) => w.isPrimary);
      if (!primaryWallet) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'No primary wallet found for user. Please link a wallet before deploying.'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 5. Fetch EVM chain config (coreAddress is needed for deployment)
      const evmServiceUrl = process.env.EVM_SERVICE_URL || 'http://localhost:3002';

      let evmConfig: EvmConfigResponse;
      try {
        const configResponse = await fetch(`${evmServiceUrl}/api/config`);
        if (!configResponse.ok) {
          throw new Error(`EVM config request failed: ${configResponse.status}`);
        }
        evmConfig = await configResponse.json();

        apiLogger.info(
          {
            requestId,
            coreAddress: evmConfig.coreAddress,
            chainId: evmConfig.chainId,
          },
          'Fetched EVM chain config'
        );
      } catch (error) {
        apiLogger.error(
          {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to fetch EVM chain config'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to fetch EVM chain config',
          error instanceof Error ? error.message : String(error)
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // 6. Generate deployment ID and store in cache
      // NOTE: We do NOT create a Strategy record yet - that happens after successful deployment
      const deploymentId = nanoid();
      const cache = CacheService.getInstance();

      const deploymentData: DeploymentCacheData = {
        deploymentId,
        status: 'pending',
        startedAt: new Date().toISOString(),
        manifest: verificationResult.parsedManifest!,
        name,
        userId: user.id,
        quoteTokenId: resolvedQuoteTokenId,
        constructorValues,
        ownerAddress: primaryWallet.address,
        coreAddress: evmConfig.coreAddress,
      };

      await cache.set(
        `deployment:${deploymentId}`,
        deploymentData,
        DEPLOYMENT_TTL_SECONDS
      );

      apiLogger.info(
        {
          requestId,
          deploymentId,
          manifestName: manifest.name,
          userId: user.id,
          coreAddress: evmConfig.coreAddress,
        },
        'Deployment data stored in cache, calling EVM service'
      );

      // 7. Call EVM service to start deployment

      let evmResult: {
        deploymentId: string;
        status: string;
        createdAt: string;
        error?: string;
      };

      try {
        // Call EVM with deploymentId (which is the cache key)
        const evmResponse = await fetch(`${evmServiceUrl}/api/deployments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategyId: deploymentId }),
        });

        if (!evmResponse.ok) {
          const errorData = await evmResponse.json().catch(() => ({}));
          apiLogger.error(
            {
              requestId,
              deploymentId,
              evmStatus: evmResponse.status,
              evmError: errorData,
            },
            'EVM service deployment request failed'
          );

          const errorResponse = createErrorResponse(
            ApiErrorCode.INTERNAL_SERVER_ERROR,
            `Deployment failed: ${errorData.error || 'EVM service error'}`,
            {
              deploymentId,
              evmError: errorData,
            }
          );

          apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: 500 });
        }

        evmResult = await evmResponse.json();
      } catch (error: unknown) {
        apiLogger.error(
          {
            requestId,
            deploymentId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to connect to EVM service'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          `Failed to connect to EVM service: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { deploymentId }
        );

        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // 8. Build response with deployment info
      // NOTE: No strategy in response - it will be created after successful deployment
      const pollUrl = `/api/v1/strategies/deploy/${deploymentId}`;

      const deployment: DeploymentInfo = {
        status: evmResult.status as DeploymentInfo['status'],
        pollUrl,
      };

      // Response without strategy (strategy created after deployment succeeds)
      const response: DeployStrategyResponse = {
        deployment,
      };

      apiLogger.info(
        {
          requestId,
          deploymentId,
          deploymentStatus: evmResult.status,
          pollUrl,
          manifestName: manifest.name,
          userId: user.id,
        },
        'Deployment initiated (strategy will be created on success)'
      );

      // Return 202 Accepted with Location header
      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);

      return new NextResponse(
        JSON.stringify(createSuccessResponse(response)),
        {
          status: 202,
          headers: {
            'Content-Type': 'application/json',
            'Location': `/api/v1/strategies/deploy/${deploymentId}`,
          },
        }
      );
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/strategies/deploy',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to initiate strategy deployment',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
