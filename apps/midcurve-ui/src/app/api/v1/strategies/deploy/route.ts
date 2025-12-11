/**
 * Strategy Deployment Endpoint
 *
 * POST /api/v1/strategies/deploy
 *
 * Authentication: Required (session or API key)
 *
 * This endpoint orchestrates strategy deployment by:
 * 1. Validating the manifest and request parameters
 * 2. Creating a strategy record in 'pending' state
 * 3. Calling the signer service to deploy the contract
 * 4. Returning deployment information with contract address
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';

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
  DeployAutomationWalletInfo,
} from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getStrategyManifestService, getStrategyService } from '@/lib/services';
import { deployStrategyContract, SignerClientError } from '@/lib/signer-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/strategies/deploy
 *
 * Initiate deployment of a strategy from a manifest.
 *
 * Request body:
 * - manifestSlug: Slug of the manifest to deploy
 * - name: User's name for this strategy instance
 * - constructorValues (optional): Values for user-input constructor parameters
 * - config (optional): Initial strategy.config values
 *
 * Returns: Strategy record with deployment status
 *
 * Example request:
 * {
 *   "manifestSlug": "funding-example-v1",
 *   "name": "My Funding Strategy",
 *   "constructorValues": {},
 *   "config": {}
 * }
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": {
 *     "strategy": {
 *       "id": "cuid",
 *       "name": "My Funding Strategy",
 *       "state": "pending",
 *       ...
 *     },
 *     "automationWallet": {
 *       "id": "pending",
 *       "address": "pending"
 *     },
 *     "deployment": {
 *       "status": "pending"
 *     }
 *   }
 * }
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
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

      const { manifestSlug, name, constructorValues, config } = validation.data;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'deploy',
        'strategy',
        user.id,
        {
          manifestSlug,
          name,
          hasConstructorValues: !!constructorValues,
          hasConfig: !!config,
        }
      );

      // 2. Fetch the manifest
      const manifest = await getStrategyManifestService().findBySlug(
        manifestSlug,
        { includeBasicCurrency: true }
      );

      if (!manifest) {
        apiLog.businessOperation(
          apiLogger,
          requestId,
          'not-found',
          'manifest',
          user.id,
          { manifestSlug }
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          `Strategy manifest '${manifestSlug}' not found`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 3. Verify manifest is active
      if (!manifest.isActive) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Strategy manifest '${manifestSlug}' is not active`
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

      // 5. Create strategy record in 'pending' state
      const strategy = await getStrategyService().create({
        userId: user.id,
        name,
        strategyType: manifest.slug, // Use manifest slug as strategy type
        config: {
          ...config,
          // Store constructor values in config for deployment
          _constructorValues: constructorValues ?? {},
        },
        quoteTokenId: manifest.basicCurrencyId,
        manifestId: manifest.id,
      });

      apiLogger.info(
        {
          requestId,
          strategyId: strategy.id,
          manifestSlug,
          userId: user.id,
        },
        'Strategy record created, calling signer service for deployment'
      );

      // 6. Call signer service to deploy the contract
      // This creates the automation wallet and deploys the contract
      const SEMSEE_CHAIN_ID = 1337; // SEMSEE local chain
      let deploymentResult;

      try {
        deploymentResult = await deployStrategyContract({
          strategyId: strategy.id,
          chainId: SEMSEE_CHAIN_ID,
          ownerAddress: primaryWallet.address,
        });
      } catch (error) {
        // If signer fails, log but still return the strategy (it can be retried)
        if (error instanceof SignerClientError) {
          apiLogger.error(
            {
              requestId,
              strategyId: strategy.id,
              errorCode: error.code,
              errorMessage: error.message,
            },
            'Signer service deployment failed'
          );

          // Return strategy with pending status - deployment can be retried
          const serializedStrategy = serializeBigInt(
            strategy
          ) as unknown as SerializedStrategy;

          const response: DeployStrategyResponse = {
            strategy: serializedStrategy,
            automationWallet: { id: 'failed', address: 'failed' },
            deployment: {
              status: 'failed',
            },
          };

          apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);
          return NextResponse.json(createSuccessResponse(response), { status: 201 });
        }
        throw error;
      }

      // 7. Re-fetch strategy to get updated contract address
      const updatedStrategy = await getStrategyService().findById(strategy.id);
      const serializedStrategy = serializeBigInt(
        updatedStrategy ?? strategy
      ) as unknown as SerializedStrategy;

      // 8. Build response with deployment result
      const automationWallet: DeployAutomationWalletInfo = {
        id: deploymentResult.automationWallet.id,
        address: deploymentResult.automationWallet.address,
      };

      const deployment: DeploymentInfo = {
        status: 'confirmed',
        transactionHash: deploymentResult.transactionHash,
        contractAddress: deploymentResult.contractAddress,
      };

      const response: DeployStrategyResponse = {
        strategy: serializedStrategy,
        automationWallet,
        deployment,
      };

      apiLogger.info(
        {
          requestId,
          strategyId: strategy.id,
          contractAddress: deploymentResult.contractAddress,
          transactionHash: deploymentResult.transactionHash,
          manifestSlug,
          userId: user.id,
        },
        'Strategy deployed successfully'
      );

      apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(response), { status: 201 });
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
