/**
 * Test Webhook Endpoint
 *
 * POST /api/v1/user/webhook-config/test - Send a test webhook
 *
 * TEMPORARILY DEACTIVATED: Will be reimplemented with proper adapter-based architecture.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createErrorResponse,
  ApiErrorCode,
} from '@midcurve/api-shared';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/user/webhook-config/test
 *
 * Temporarily returns 501 Not Implemented.
 */
export async function POST(_request: NextRequest): Promise<Response> {
  const errorResponse = createErrorResponse(
    ApiErrorCode.INTERNAL_SERVER_ERROR,
    'Test webhook endpoint is temporarily unavailable',
    'This feature will be reimplemented with the new adapter-based notification architecture'
  );

  return NextResponse.json(errorResponse, { status: 501 });
}
