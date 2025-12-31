/**
 * Verify Manifest Endpoint
 *
 * POST /api/v1/strategies/verify-manifest
 *
 * Authentication: Required (session only)
 *
 * Validates an uploaded strategy manifest file before deployment.
 * Performs schema validation, ABI parsing, and constructor parameter matching.
 * Also performs on-chain token discovery for the funding token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';
import { ManifestVerificationService } from '@midcurve/services';
import { getErc20TokenService } from '@/lib/services';
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
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OPTIONS /api/v1/strategies/verify-manifest
 *
 * CORS preflight handler
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/strategies/verify-manifest
 *
 * Validates an uploaded strategy manifest file.
 * Returns detailed validation errors and warnings.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
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

      // Verify the manifest with async token resolution
      // This discovers the funding token on-chain to validate it exists
      // and fetch its metadata (symbol, name, decimals)
      const verificationService = new ManifestVerificationService();
      const erc20Service = getErc20TokenService();
      const result = await verificationService.verifyWithTokenResolution(
        manifest,
        erc20Service
      );

      apiLogger.info(
        {
          requestId,
          userId: user.id,
          valid: result.valid,
          errorCount: result.errors.length,
          warningCount: result.warnings.length,
          resolvedFundingTokenId: result.resolvedFundingTokenId,
        },
        'Manifest verification complete'
      );

      const responseData: VerifyManifestResponse = {
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        parsedManifest: result.parsedManifest,
        resolvedFundingTokenId: result.resolvedFundingTokenId,
        resolvedFundingToken: result.resolvedFundingToken,
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(createSuccessResponse(responseData));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      apiLog.methodError(
        apiLogger,
        'POST /api/v1/strategies/verify-manifest',
        error,
        { requestId, errorMessage }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        `Failed to verify manifest: ${errorMessage}`
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
