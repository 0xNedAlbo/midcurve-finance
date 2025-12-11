/**
 * Strategy Manifest Detail Endpoint
 *
 * GET /api/v1/strategies/manifests/:slug
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
  GetManifestParamsSchema,
  GetManifestQuerySchema,
} from '@midcurve/api-shared';
import type {
  GetManifestResponse,
  SerializedStrategyManifest,
} from '@midcurve/api-shared';
import { serializeBigInt } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getStrategyManifestService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/strategies/manifests/:slug
 *
 * Get a specific strategy manifest by its unique slug.
 *
 * Path parameters:
 * - slug: Manifest slug (e.g., 'funding-example-v1')
 *
 * Query parameters:
 * - includeBasicCurrency (optional): Include basic currency token in response
 *
 * Returns: Single strategy manifest
 *
 * Example response:
 * {
 *   "success": true,
 *   "data": {
 *     "manifest": {
 *       "id": "cuid",
 *       "slug": "funding-example-v1",
 *       "name": "Funding Example Strategy",
 *       "description": "...",
 *       "version": "1.0.0",
 *       "abi": [...],
 *       "bytecode": "0x...",
 *       "constructorParams": [...],
 *       "capabilities": { "funding": true, ... },
 *       "userParams": [...],
 *       ...
 *     }
 *   }
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // 1. Validate path parameters
      const { slug } = await params;
      const paramsValidation = GetManifestParamsSchema.safeParse({ slug });

      if (!paramsValidation.success) {
        apiLog.validationError(
          apiLogger,
          requestId,
          paramsValidation.error.errors
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          paramsValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      // 2. Parse and validate query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        includeBasicCurrency:
          searchParams.get('includeBasicCurrency') ?? undefined,
      };

      const queryValidation = GetManifestQuerySchema.safeParse(queryParams);

      if (!queryValidation.success) {
        apiLog.validationError(
          apiLogger,
          requestId,
          queryValidation.error.errors
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          queryValidation.error.errors
        );

        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { includeBasicCurrency } = queryValidation.data;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'get',
        'strategy-manifest',
        user.id,
        {
          slug: paramsValidation.data.slug,
          includeBasicCurrency,
        }
      );

      // 3. Query manifest from service
      const manifest = await getStrategyManifestService().findBySlug(
        paramsValidation.data.slug,
        { includeBasicCurrency }
      );

      if (!manifest) {
        apiLog.businessOperation(
          apiLogger,
          requestId,
          'not-found',
          'strategy-manifest',
          user.id,
          { slug: paramsValidation.data.slug }
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          `Strategy manifest '${paramsValidation.data.slug}' not found`
        );

        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);

        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.NOT_FOUND],
        });
      }

      // 4. Serialize manifest for JSON response
      const serializedManifest = serializeBigInt(
        manifest
      ) as SerializedStrategyManifest;

      // 5. Create response
      const response: GetManifestResponse = {
        manifest: serializedManifest,
      };

      apiLogger.info(
        {
          requestId,
          slug: manifest.slug,
          name: manifest.name,
        },
        'Strategy manifest retrieved successfully'
      );

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

      return NextResponse.json(createSuccessResponse(response), { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/strategies/manifests/:slug',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve strategy manifest',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
