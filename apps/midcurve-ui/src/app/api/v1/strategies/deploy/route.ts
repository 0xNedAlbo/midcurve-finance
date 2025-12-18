/**
 * Strategy Deployment Endpoint
 *
 * POST /api/v1/strategies/deploy
 *
 * Authentication: Required (session or API key)
 *
 * This endpoint orchestrates strategy deployment by:
 * 1. Validating the manifest (re-verify for security)
 * 2. Creating a strategy record in 'pending' state with embedded manifest
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
import { getStrategyService } from '@/lib/services';
import {
  SignerClient,
  SignerClientError,
  ManifestVerificationService,
} from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/strategies/deploy
 *
 * Deploy a strategy from an uploaded manifest.
 *
 * Request body:
 * - manifest: Full strategy manifest (ABI, bytecode, constructorParams)
 * - name: User's name for this strategy instance
 * - constructorValues: Values for user-input constructor parameters
 * - quoteTokenId: Quote token ID for metrics denomination
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
 *     "constructorParams": [...]
 *   },
 *   "name": "My Delta Neutral Strategy",
 *   "constructorValues": { "_targetApr": "500" },
 *   "quoteTokenId": "token-id-here"
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

      const { manifest, name, constructorValues, quoteTokenId } =
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

      // 3. Get user's primary wallet address (for owner parameter)
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

      // 4. Create strategy record in 'pending' state with embedded manifest
      const strategy = await getStrategyService().create({
        userId: user.id,
        name,
        strategyType: manifest.name, // Use manifest name as strategy type
        config: {
          // Store constructor values in config for deployment
          _constructorValues: constructorValues,
        },
        quoteTokenId,
        manifest: verificationResult.parsedManifest!, // Use verified manifest
      });

      apiLogger.info(
        {
          requestId,
          strategyId: strategy.id,
          manifestName: manifest.name,
          userId: user.id,
        },
        'Strategy record created, calling signer service for deployment'
      );

      // 5. Call signer service to deploy the contract
      // This creates the automation wallet and deploys the contract
      const SEMSEE_CHAIN_ID = 31337; // SEMSEE local chain (matches genesis.json)
      let deploymentResult;

      try {
        deploymentResult = await SignerClient.getInstance().deployStrategyContract({
          strategyId: strategy.id,
          chainId: SEMSEE_CHAIN_ID,
          ownerAddress: primaryWallet.address,
        });
      } catch (error: unknown) {
        // If signer fails, return an error response
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

          // Return error response with strategy ID for potential retry
          const errorResponse = createErrorResponse(
            ApiErrorCode.INTERNAL_SERVER_ERROR,
            `Deployment failed: ${error.message}`,
            {
              strategyId: strategy.id,
              signerErrorCode: error.code,
            }
          );

          apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
          return NextResponse.json(errorResponse, { status: 500 });
        }
        throw error;
      }

      // 6. Re-fetch strategy to get updated contract address
      const updatedStrategy = await getStrategyService().findById(strategy.id);
      const serializedStrategy = serializeBigInt(
        updatedStrategy ?? strategy
      ) as unknown as SerializedStrategy;

      // 7. Build response with deployment result
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
          manifestName: manifest.name,
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
