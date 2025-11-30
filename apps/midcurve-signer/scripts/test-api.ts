#!/usr/bin/env npx tsx
/**
 * Test script for midcurve-signer API
 *
 * Usage:
 *   npx tsx scripts/test-api.ts <METHOD> <ENDPOINT> [JSON_BODY]
 *
 * Examples:
 *   npx tsx scripts/test-api.ts GET /api/health
 *   npx tsx scripts/test-api.ts GET /api/wallets/user123
 *   npx tsx scripts/test-api.ts POST /api/wallets '{"userId":"user123","label":"My Wallet"}'
 *   npx tsx scripts/test-api.ts POST /api/sign/test-evm-wallet '{"userId":"...","signedIntent":{...}}'
 *
 * Environment:
 *   SIGNER_API_URL - Base URL (default: http://localhost:3001)
 *   SIGNER_INTERNAL_API_KEY - API key for authentication
 */

const BASE_URL = process.env.SIGNER_API_URL || 'http://localhost:3001';
const API_KEY = process.env.SIGNER_INTERNAL_API_KEY;

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(`
Usage: npx tsx scripts/test-api.ts <METHOD> <ENDPOINT> [JSON_BODY]

Examples:
  npx tsx scripts/test-api.ts GET /api/health
  npx tsx scripts/test-api.ts GET /api/wallets/user123
  npx tsx scripts/test-api.ts POST /api/wallets '{"userId":"user123","label":"My Wallet"}'

Environment variables:
  SIGNER_API_URL          - Base URL (default: http://localhost:3001)
  SIGNER_INTERNAL_API_KEY - API key for authentication (required for non-health endpoints)
`);
    process.exit(1);
  }

  const method = args[0]!.toUpperCase();
  const endpoint = args[1]!;
  const jsonBody = args[2];

  // Build URL
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  } else if (!endpoint.includes('/health')) {
    console.warn('⚠️  Warning: SIGNER_INTERNAL_API_KEY not set. Authentication may fail.\n');
  }

  // Parse body if provided
  let body: string | undefined;
  if (jsonBody) {
    try {
      // Validate it's valid JSON
      JSON.parse(jsonBody);
      body = jsonBody;
    } catch (e) {
      console.error('❌ Invalid JSON body:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
  }

  // Log request
  console.log(`🚀 ${method} ${url}`);
  if (body) {
    console.log(`📦 Body: ${body.length > 200 ? body.slice(0, 200) + '...' : body}`);
  }
  console.log('');

  try {
    const startTime = Date.now();

    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
    });

    const duration = Date.now() - startTime;

    // Try to parse as JSON
    const contentType = response.headers.get('content-type');
    let data: unknown;

    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Log response
    const statusEmoji = response.ok ? '✅' : '❌';
    console.log(`${statusEmoji} Status: ${response.status} ${response.statusText} (${duration}ms)`);
    console.log('');

    if (typeof data === 'string') {
      console.log(data);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }

    process.exit(response.ok ? 0 : 1);
  } catch (error) {
    console.error('❌ Request failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
