/**
 * Strategy Manifests List Endpoint
 *
 * GET /api/v1/strategies/manifests
 *
 * Authentication: Required (session or API key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';

import {
  createErrorResponse,
  createSuccessResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  ListManifestsQuerySchema,
} from '@midcurve/api-shared';
import type {
  ListManifestsResponse,
  SerializedStrategyManifest,
} from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getStrategyManifestService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/strategies/manifests
 *
 * List available strategy manifests with optional filtering.
 *
 * Query parameters:
 * - isActive (optional): Filter by active status (default: only active)
 * - basicCurrencyId (optional): Filter by basic currency
 * - tags (optional): Comma-separated tags to filter by (OR logic)
 * - includeBasicCurrency (optional): Include basic currency token in response
 *
 * Returns: List of strategy manifests
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": {
 *     "manifests": [
 *       {
 *         "id": "cuid",
 *         "slug": "funding-example-v1",
 *         "name": "Funding Example Strategy",
 *         "description": "...",
 *         "version": "1.0.0",
 *         "capabilities": { "funding": true, ... },
 *         ...
 *       }
 *     ]
 *   }
 * }
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Parse and validate query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        isActive: searchParams.get('isActive') ?? undefined,
        basicCurrencyId: searchParams.get('basicCurrencyId') ?? undefined,
        tags: searchParams.get('tags') ?? undefined,
        includeBasicCurrency:
          searchParams.get('includeBasicCurrency') ?? undefined,
      };

      const validation = ListManifestsQuerySchema.safeParse(queryParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          validation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { isActive, basicCurrencyId, tags, includeBasicCurrency } =
        validation.data;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'list',
        'strategy-manifests',
        user.id,
        {
          isActive,
          basicCurrencyId,
          tags,
          includeBasicCurrency,
        }
      );

      // 2. Query manifests from service
      const manifests = await getStrategyManifestService().findAll({
        isActive: isActive ?? true, // Default to only active manifests
        basicCurrencyId,
        tags,
        includeBasicCurrency,
      });

      // 3. Serialize manifests for JSON response
      const serializedManifests = manifests.map((manifest) =>
        serializeBigInt(manifest)
      ) as SerializedStrategyManifest[];

      // 4. Create response
      const response: ListManifestsResponse = {
        manifests: serializedManifests,
      };

      apiLogger.info(
        {
          requestId,
          count: manifests.length,
        },
        'Strategy manifests retrieved successfully'
      );

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(response), { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/strategies/manifests',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve strategy manifests',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
