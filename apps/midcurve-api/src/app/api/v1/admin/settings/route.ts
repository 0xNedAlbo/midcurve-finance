/**
 * Admin Settings Endpoint
 *
 * GET   /api/v1/admin/settings — Returns current settings (API keys masked) + allowlist
 * PATCH /api/v1/admin/settings — Update settings and/or allowlist
 *
 * Requires authenticated admin session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { normalizeAddress } from '@midcurve/shared';
import { prisma } from '@midcurve/database';
import {
  SettingService,
  resetAppConfig,
  initAppConfig,
} from '@midcurve/services';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { apiLogger, apiLog } from '@/lib/logger';
import { getCorsHeaders, createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mask a secret value, showing only the last 4 characters. */
function mask(value: string): string {
  if (value.length <= 4) return '****';
  return '****' + value.slice(-4);
}

/** Map from camelCase request keys to snake_case database keys. */
const KEY_MAP: Record<string, string> = {
  alchemyApiKey: 'alchemy_api_key',
  theGraphApiKey: 'the_graph_api_key',
  walletconnectProjectId: 'walletconnect_project_id',
  coingeckoApiKey: 'coingecko_api_key',
};

/** Settings that should be masked in GET responses. */
const MASKED_KEYS = new Set([
  'alchemy_api_key',
  'the_graph_api_key',
  'coingecko_api_key',
]);

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/admin/settings
 * Returns all settings with sensitive values masked, plus the allowlist.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const origin = request.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin);

    if (!user.isAdmin) {
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.FORBIDDEN, 'Admin access required'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.FORBIDDEN], headers: corsHeaders },
      );
    }

    const settingService = SettingService.getInstance();
    const all = await settingService.getAll();

    // Build response with masked sensitive values
    const settings: Record<string, string> = {};
    for (const [key, value] of Object.entries(all)) {
      settings[key] = MASKED_KEYS.has(key) ? mask(value) : value;
    }

    // Fetch allowlist entries
    const allowlistEntries = await prisma.userAllowListEntry.findMany({
      orderBy: { createdAt: 'asc' },
    });
    const allowlist = allowlistEntries.map((e) => e.address);

    apiLog.requestEnd(apiLogger, requestId, 200, 0);

    return NextResponse.json(
      createSuccessResponse({ settings, allowlist }),
      { status: 200, headers: corsHeaders },
    );
  });
}

/**
 * PATCH /api/v1/admin/settings
 * Update one or more settings and/or the allowlist. Only provided fields are updated.
 *
 * Body:
 * - alchemyApiKey, theGraphApiKey, walletconnectProjectId, coingeckoApiKey (optional strings)
 * - allowlist: string[] of EVM addresses (optional). Admin addresses are preserved automatically.
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const origin = request.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin);

    if (!user.isAdmin) {
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.FORBIDDEN, 'Admin access required'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.FORBIDDEN], headers: corsHeaders },
      );
    }

    const body = await request.json() as Record<string, unknown>;

    // Build settings update map from provided fields
    const updates: Record<string, string> = {};
    for (const [camelKey, dbKey] of Object.entries(KEY_MAP)) {
      const value = body[camelKey];
      if (typeof value === 'string' && value.length > 0) {
        updates[dbKey] = value;
      }
    }

    const hasSettingsUpdates = Object.keys(updates).length > 0;
    const hasAllowlistUpdate = Array.isArray(body.allowlist);

    if (!hasSettingsUpdates && !hasAllowlistUpdate) {
      return NextResponse.json(
        createErrorResponse(ApiErrorCode.VALIDATION_ERROR, 'No valid fields provided'),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR], headers: corsHeaders },
      );
    }

    // Persist settings updates
    if (hasSettingsUpdates) {
      const settingService = SettingService.getInstance();
      await settingService.setMany(updates);
    }

    // Sync allowlist
    if (hasAllowlistUpdate) {
      const rawAddresses = body.allowlist as string[];

      // Validate and normalize all provided addresses
      const normalizedAddresses: string[] = [];
      for (const addr of rawAddresses) {
        const trimmed = addr.trim();
        if (trimmed.length === 0) continue;
        if (!isAddress(trimmed)) {
          return NextResponse.json(
            createErrorResponse(ApiErrorCode.VALIDATION_ERROR, `Invalid address in allowlist: ${trimmed}`),
            { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR], headers: corsHeaders },
          );
        }
        normalizedAddresses.push(normalizeAddress(trimmed));
      }

      // Get all admin users — their addresses must never be removed
      const adminUsers = await prisma.user.findMany({
        where: { isAdmin: true },
        select: { address: true },
      });
      const adminAddresses = new Set(adminUsers.map((u) => u.address));

      // Build desired set (provided addresses + admin addresses)
      const desiredSet = new Set(normalizedAddresses);
      for (const adminAddr of adminAddresses) {
        desiredSet.add(adminAddr);
      }

      // Get current allowlist
      const currentEntries = await prisma.userAllowListEntry.findMany();
      const currentSet = new Set(currentEntries.map((e) => e.address));

      // Determine adds and removes
      const toAdd = [...desiredSet].filter((addr) => !currentSet.has(addr));
      const toRemove = [...currentSet].filter((addr) => !desiredSet.has(addr));

      if (toAdd.length > 0 || toRemove.length > 0) {
        await prisma.$transaction([
          // Remove entries no longer in the list (admin addresses already excluded above)
          ...(toRemove.length > 0
            ? [prisma.userAllowListEntry.deleteMany({ where: { address: { in: toRemove } } })]
            : []),
          // Add new entries
          ...toAdd.map((address) =>
            prisma.userAllowListEntry.create({
              data: { address, note: 'added via settings' },
            }),
          ),
        ]);
      }
    }

    // Reload app config singletons if settings changed
    if (hasSettingsUpdates) {
      resetAppConfig();
      await initAppConfig();
    }

    apiLog.businessOperation(apiLogger, requestId, 'updated', 'settings', user.id, {
      updatedKeys: Object.keys(updates),
      allowlistUpdated: hasAllowlistUpdate,
    });
    apiLog.requestEnd(apiLogger, requestId, 200, 0);

    return NextResponse.json(
      createSuccessResponse({ success: true }),
      { status: 200, headers: corsHeaders },
    );
  });
}
