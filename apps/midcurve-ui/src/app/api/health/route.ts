/**
 * Health Check API Endpoint
 *
 * GET /api/health
 * Returns the health status of the API service.
 * No authentication required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { createSuccessResponse, HealthStatus, type HealthResponse } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse<HealthResponse>> {
  const requestId = nanoid();
  const startTime = Date.now();

  apiLog.requestStart(apiLogger, requestId, request);

  const healthData = {
    status: HealthStatus.HEALTHY,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version,
    uptime: process.uptime(),
  };

  const response = createSuccessResponse(healthData);

  apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
