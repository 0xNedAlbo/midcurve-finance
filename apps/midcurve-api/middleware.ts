/**
 * Next.js Edge Middleware
 *
 * Handles CORS preflight requests at the edge level before route handlers.
 * This ensures OPTIONS requests don't get redirected or blocked.
 */

import { NextRequest, NextResponse } from 'next/server';

// Parse allowed origins from environment variable or use defaults
const ALLOWED_ORIGINS_ENV = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? [];

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000', // UI dev server (Vite)
  'http://localhost:5173', // Vite default port
  'https://app.midcurve.finance', // Production UI
];

const ALLOWED_ORIGINS = ALLOWED_ORIGINS_ENV.length > 0 ? ALLOWED_ORIGINS_ENV : DEFAULT_ALLOWED_ORIGINS;

function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && ALLOWED_ORIGINS.includes(origin);
  const allowedOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');

  // Handle preflight (OPTIONS) requests immediately
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  }

  // For all other requests, continue and let route handlers process
  // but add CORS headers to the response
  const response = NextResponse.next();

  const corsHeaders = getCorsHeaders(origin);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

// Apply middleware to all API routes
export const config = {
  matcher: '/api/:path*',
};
