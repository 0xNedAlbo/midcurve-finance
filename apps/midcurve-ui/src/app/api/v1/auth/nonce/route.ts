/**
 * Nonce Generation Endpoint
 *
 * GET /api/v1/auth/nonce
 *
 * Generates a cryptographically secure nonce for SIWE authentication.
 * The nonce is stored in PostgreSQL Cache with a 10-minute TTL.
 *
 * No authentication required (public endpoint).
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "nonce": "siwe_abc123def456..."
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { AuthNonceService } from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const nonceService = new AuthNonceService();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const startTime = Date.now();

  apiLog.requestStart(apiLogger, requestId, request);

  try {
    // Generate nonce and store in cache (10-minute TTL)
    const nonce = await nonceService.generateNonce();

    apiLog.businessOperation(apiLogger, requestId, 'generated', 'nonce', nonce.slice(0, 15));

    const response = createSuccessResponse({
      nonce,
    });

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, must-revalidate',
      },
    });
  } catch (error) {
    apiLog.methodError(apiLogger, 'GET /api/v1/auth/nonce', error, { requestId });

    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to generate nonce',
      error instanceof Error ? error.message : String(error)
    );

    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);

    return NextResponse.json(errorResponse, {
      status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}
