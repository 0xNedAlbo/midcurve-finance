/**
 * Strategy Deployment Endpoint
 *
 * POST /api/v1/strategies/deploy
 *
 * Authentication: Required (session or API key)
 *
 * This endpoint initiates strategy deployment by:
 * 1. Validating the manifest and request parameters
 * 2. Creating a strategy record in 'pending' state
 * 3. Returning deployment information
 *
 * The actual contract deployment and wallet creation is handled
 * asynchronously by the signer service.
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

      // 4. Create strategy record
      // Note: Strategy is created in 'pending' state
      // The signer service will pick it up and:
      // - Create automation wallet
      // - Deploy contract
      // - Update strategy with contractAddress
      // - Transition to awaiting start() signature
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

      // 5. Serialize for response
      const serializedStrategy = serializeBigInt(
        strategy
      ) as unknown as SerializedStrategy;

      // 6. Build deployment info
      // Automation wallet is pending creation by signer service
      const automationWallet: DeployAutomationWalletInfo = {
        id: 'pending',
        address: 'pending',
      };

      const deployment: DeploymentInfo = {
        status: 'pending',
      };

      // 7. Create response
      const response: DeployStrategyResponse = {
        strategy: serializedStrategy,
        automationWallet,
        deployment,
      };

      apiLogger.info(
        {
          requestId,
          strategyId: strategy.id,
          manifestSlug,
          userId: user.id,
        },
        'Strategy deployment initiated'
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
