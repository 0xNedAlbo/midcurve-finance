/**
 * Next.js Middleware — 503 guard for unconfigured state
 *
 * Intercepts all `/api/v1/*` requests. If AppConfig hasn't been initialized
 * (settings not yet saved via config wizard), returns 503 Service Unavailable.
 *
 * Does NOT intercept:
 * - `/api/health` — always available for container health checks
 * - `/api/config` — needed for the wizard itself
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAppConfigReady } from '@midcurve/services';
import { getCorsHeaders } from '@/lib/cors';

export const config = {
  matcher: '/api/v1/:path*',
};

export function middleware(request: NextRequest): NextResponse | undefined {
  if (isAppConfigReady()) {
    return undefined; // pass through
  }

  const origin = request.headers.get('origin');

  return NextResponse.json(
    {
      error: {
        code: 'NOT_CONFIGURED',
        message: 'Application not yet configured. Complete the setup wizard first.',
      },
    },
    {
      status: 503,
      headers: {
        'Retry-After': '30',
        ...getCorsHeaders(origin),
      },
    },
  );
}
