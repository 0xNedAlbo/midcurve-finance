/**
 * Config API Endpoint
 *
 * GET  /api/config — Public config status (configured or not, plus public keys)
 * POST /api/config — Save wizard config (requires CONFIG_PASSWORD header)
 *
 * No session authentication required — this endpoint is used before auth is available.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getAddress, isAddress } from 'viem';
import { prisma } from '@midcurve/database';
import {
  SystemConfigService,
  REQUIRED_SYSTEM_CONFIG_KEYS,
  initAppConfig,
} from '@midcurve/services';
import { createSuccessResponse, createErrorResponse, ApiErrorCode, ErrorCodeToHttpStatus } from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getCorsHeaders, createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/config
 * Returns whether the app is configured and any public config values.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const origin = request.headers.get('origin');
  apiLog.requestStart(apiLogger, requestId, request);

  const systemConfigService = SystemConfigService.getInstance();
  const configured = await systemConfigService.hasAll([...REQUIRED_SYSTEM_CONFIG_KEYS]);

  let responseData: Record<string, unknown>;

  if (!configured) {
    responseData = { configured: false };
  } else {
    // Only return inherently public values (WalletConnect project ID is domain-gated)
    const settings = await systemConfigService.getMany(['walletconnect_project_id', 'operator.address']);
    responseData = {
      configured: true,
      walletconnectProjectId: settings['walletconnect_project_id'],
      operatorAddress: settings['operator.address'] ?? null,
    };
  }

  apiLog.requestEnd(apiLogger, requestId, 200, 0);

  return NextResponse.json(createSuccessResponse(responseData), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, must-revalidate',
      ...getCorsHeaders(origin),
    },
  });
}

/**
 * POST /api/config
 * Save wizard configuration. Requires X-Config-Password header.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = nanoid();
  const origin = request.headers.get('origin');
  apiLog.requestStart(apiLogger, requestId, request);

  const corsHeaders = getCorsHeaders(origin);

  // Validate CONFIG_PASSWORD
  const configPassword = process.env.CONFIG_PASSWORD;
  if (!configPassword) {
    apiLog.requestEnd(apiLogger, requestId, 500, 0);
    return NextResponse.json(
      createErrorResponse(ApiErrorCode.INTERNAL_SERVER_ERROR, 'CONFIG_PASSWORD env var not set on server'),
      { status: 500, headers: corsHeaders },
    );
  }

  const providedPassword = request.headers.get('X-Config-Password');
  if (!providedPassword || providedPassword !== configPassword) {
    apiLog.requestEnd(apiLogger, requestId, 401, 0);
    return NextResponse.json(
      createErrorResponse(ApiErrorCode.UNAUTHORIZED, 'Invalid config password'),
      { status: ErrorCodeToHttpStatus[ApiErrorCode.UNAUTHORIZED], headers: corsHeaders },
    );
  }

  // Parse and validate body
  const body = await request.json() as Record<string, unknown>;

  const { alchemyApiKey, theGraphApiKey, walletconnectProjectId, adminWalletAddress, coingeckoApiKey } = body as {
    alchemyApiKey?: string;
    theGraphApiKey?: string;
    walletconnectProjectId?: string;
    adminWalletAddress?: string;
    coingeckoApiKey?: string;
  };

  // Required fields
  if (!alchemyApiKey || !theGraphApiKey || !walletconnectProjectId || !adminWalletAddress) {
    apiLog.requestEnd(apiLogger, requestId, 400, 0);
    return NextResponse.json(
      createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Missing required fields: alchemyApiKey, theGraphApiKey, walletconnectProjectId, adminWalletAddress'),
      { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR], headers: corsHeaders },
    );
  }

  // Validate admin address
  if (!isAddress(adminWalletAddress)) {
    apiLog.requestEnd(apiLogger, requestId, 400, 0);
    return NextResponse.json(
      createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'Invalid adminWalletAddress — must be a valid EVM address'),
      { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR], headers: corsHeaders },
    );
  }

  const normalizedAddress = getAddress(adminWalletAddress);

  // Save everything in a transaction
  const systemConfigService = SystemConfigService.getInstance();
  const settings: Record<string, string> = {
    alchemy_api_key: alchemyApiKey,
    the_graph_api_key: theGraphApiKey,
    walletconnect_project_id: walletconnectProjectId,
    admin_wallet_address: normalizedAddress,
  };
  if (coingeckoApiKey) {
    settings['coingecko_api_key'] = coingeckoApiKey;
  }

  await systemConfigService.setMany(settings);

  // Upsert allowlist entry + user with isAdmin
  await prisma.$transaction([
    prisma.userAllowListEntry.upsert({
      where: { address: normalizedAddress },
      update: {},
      create: { address: normalizedAddress, note: 'admin (config wizard)' },
    }),
    prisma.user.upsert({
      where: { address: normalizedAddress },
      update: { isAdmin: true },
      create: { address: normalizedAddress, isAdmin: true },
    }),
  ]);

  // Initialize AppConfig (loads system config into singletons like EvmConfig)
  // Must complete before returning — the UI navigates to the dashboard immediately after.
  await initAppConfig();

  apiLog.requestEnd(apiLogger, requestId, 200, 0);

  return NextResponse.json(createSuccessResponse({ success: true }), {
    status: 200,
    headers: corsHeaders,
  });
}
