/**
 * Verify Manifest Endpoint
 *
 * POST /api/v1/strategies/verify-manifest
 *
 * Validates an uploaded strategy manifest file before deployment.
 * Performs schema validation, ABI parsing, and constructor parameter matching.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ManifestVerificationService } from '@midcurve/services';
import type {
  VerifyManifestRequest,
  VerifyManifestResponse,
} from '@midcurve/api-shared';
import {
  VerifyManifestRequestSchema,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  createSuccessResponse,
  createErrorResponse,
} from '@midcurve/api-shared';
import { withAuth } from '@/middleware/with-auth';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/strategies/verify-manifest
 *
 * Validates an uploaded strategy manifest file.
 * Returns detailed validation errors and warnings.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    apiLog.businessOperation(
      apiLogger,
      requestId,
      'verify',
      'manifest',
      user.id,
      { action: 'verify-manifest' }
    );

    try {
      // Parse and validate request body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        apiLog.validationError(apiLogger, requestId, 'Invalid JSON');

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const parseResult = VerifyManifestRequestSchema.safeParse(body);

      if (!parseResult.success) {
        apiLog.validationError(apiLogger, requestId, parseResult.error.errors);

        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          parseResult.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { manifest } = parseResult.data as VerifyManifestRequest;

      // Verify the manifest using the service
      const verificationService = new ManifestVerificationService();
      const result = verificationService.verify(manifest);

      apiLogger.info(
        {
          requestId,
          userId: user.id,
          valid: result.valid,
          errorCount: result.errors.length,
          warningCount: result.warnings.length,
        },
        'Manifest verification complete'
      );

      const responseData: VerifyManifestResponse = {
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        parsedManifest: result.parsedManifest,
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(createSuccessResponse(responseData));
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/strategies/verify-manifest',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to verify manifest'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
