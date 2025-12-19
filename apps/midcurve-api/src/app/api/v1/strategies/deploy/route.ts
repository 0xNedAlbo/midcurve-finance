/**
 * Strategy Deployment Endpoint
 *
 * POST /api/v1/strategies/deploy
 *
 * Authentication: Required (session only)
 *
 * This endpoint orchestrates strategy deployment by:
 * 1. Validating the manifest (re-verify for security)
 * 2. Creating a strategy record in 'deploying' state with embedded manifest
 * 3. Calling the EVM service to initiate deployment (async)
 * 4. Returning 202 Accepted with deployment status and poll URL
 */

import { NextRequest, NextResponse } from 'next/server';
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
  SerializedStrategy,
  DeploymentInfo,
} from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getStrategyService } from '@/lib/services';
import {
  ManifestVerificationService,
  BasicCurrencyTokenService,
  Erc20TokenService,
} from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
 * Returns: Strategy record with deployment status
 *
 * Example request:
 * {
 *   "manifest": {
 *     "name": "Delta Neutral Strategy",
 *     "version": "1.0.0",
 *     "abi": [...],
 *     "bytecode": "0x...",
 *     "constructorParams": [...],
 *     "quoteToken": { "type": "basic-currency", "symbol": "USD" }
 *   },
 *   "name": "My Delta Neutral Strategy",
 *   "constructorValues": { "_targetApr": "500" }
 * }
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

      const { manifest, name, constructorValues } =
        validation.data;

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
      // The manifest contains the quote token specification, we need to find or create
      // the actual Token record in the database
      const quoteToken = verificationResult.parsedManifest!.quoteToken;
      let resolvedQuoteTokenId: string;

      try {
        if (quoteToken.type === 'basic-currency') {
          // Basic currency: find or create from symbol (validates against CoinGecko)
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
          // ERC-20 token: find or discover from chain
          const erc20Service = new Erc20TokenService();
          const token = await erc20Service.discover({
            chainId: quoteToken.chainId,
            address: quoteToken.address,
          });

          // Validate manifest symbol matches on-chain symbol (case-sensitive)
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

      // 5. Create strategy record in 'pending' state with embedded manifest
      const strategy = await getStrategyService().create({
        userId: user.id,
        name,
        strategyType: manifest.name, // Use manifest name as strategy type
        config: {
          // Store constructor values in config for deployment
          _constructorValues: constructorValues,
        },
        quoteTokenId: resolvedQuoteTokenId,
        manifest: verificationResult.parsedManifest!, // Use verified manifest
      });

      apiLogger.info(
        {
          requestId,
          strategyId: strategy.id,
          manifestName: manifest.name,
          userId: user.id,
        },
        'Strategy record created, calling EVM service for deployment'
      );

      // 6. Call EVM service to start deployment
      // The EVM service handles signing, broadcasting, and RabbitMQ topology setup
      const evmServiceUrl = process.env.EVM_SERVICE_URL || 'http://localhost:3002';

      let evmResult: {
        strategyId: string;
        status: string;
        contractAddress?: string;
        txHash?: string;
        pollUrl: string;
        error?: string;
      };

      try {
        const evmResponse = await fetch(`${evmServiceUrl}/api/strategy`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategyId: strategy.id }),
        });

        if (!evmResponse.ok) {
          const errorData = await evmResponse.json().catch(() => ({}));
          apiLogger.error(
            {
              requestId,
              strategyId: strategy.id,
              evmStatus: evmResponse.status,
              evmError: errorData,
            },
            'EVM service deployment request failed'
          );

          const errorResponse = createErrorResponse(
            ApiErrorCode.INTERNAL_SERVER_ERROR,
            `Deployment failed: ${errorData.error || 'EVM service error'}`,
            {
              strategyId: strategy.id,
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
            strategyId: strategy.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to connect to EVM service'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          `Failed to connect to EVM service: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { strategyId: strategy.id }
        );

        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // 7. Build response with async deployment info
      const serializedStrategy = serializeBigInt(strategy) as unknown as SerializedStrategy;

      const deployment: DeploymentInfo = {
        status: evmResult.status as DeploymentInfo['status'],
        transactionHash: evmResult.txHash,
        contractAddress: evmResult.contractAddress,
        pollUrl: evmResult.pollUrl,
      };

      const response: DeployStrategyResponse = {
        strategy: serializedStrategy,
        deployment,
      };

      apiLogger.info(
        {
          requestId,
          strategyId: strategy.id,
          deploymentStatus: evmResult.status,
          pollUrl: evmResult.pollUrl,
          manifestName: manifest.name,
          userId: user.id,
        },
        'Strategy deployment initiated'
      );

      // Return 202 Accepted for async deployment
      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(response), { status: 202 });
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
