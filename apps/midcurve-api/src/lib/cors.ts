/**
 * CORS Configuration for Cross-Origin API Requests
 *
 * Enables the static React UI (on different subdomain) to communicate
 * with this API server while maintaining secure cookie-based sessions.
 */

// Parse allowed origins from environment variable or use defaults
const ALLOWED_ORIGINS_ENV = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ?? [];

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000', // UI dev server (Vite)
  'http://localhost:5173', // Vite default port
  'https://app.midcurve.finance', // Production UI
];

const ALLOWED_ORIGINS = ALLOWED_ORIGINS_ENV.length > 0 ? ALLOWED_ORIGINS_ENV : DEFAULT_ALLOWED_ORIGINS;

/**
 * Get CORS headers for a given request origin
 *
 * @param origin - The Origin header from the request
 * @returns Record of CORS headers to add to the response
 */
export function getCorsHeaders(origin: string | null): Record<string, string> {
  // Check if the origin is in our allowed list
  const isAllowed = origin && ALLOWED_ORIGINS.includes(origin);

  // Use the actual origin if allowed, otherwise use the first allowed origin
  // (This ensures we don't reflect arbitrary origins)
  const allowedOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true', // Required for cookies
    'Access-Control-Max-Age': '86400', // 24 hours preflight cache
  };
}

/**
 * Apply CORS headers to a Response object
 *
 * @param response - The Response to add headers to
 * @param origin - The Origin header from the request
 * @returns The same Response with CORS headers added
 */
export function applyCorsHeaders(response: Response, origin: string | null): Response {
  const headers = getCorsHeaders(origin);
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

/**
 * Create a preflight (OPTIONS) response with CORS headers
 *
 * @param origin - The Origin header from the request
 * @returns A 204 No Content response with CORS headers
 */
export function createPreflightResponse(origin: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
