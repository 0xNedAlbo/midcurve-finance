/**
 * User API Keys Endpoint
 *
 * GET  /api/v1/user/api-keys - List authenticated user's API keys (display data only)
 * POST /api/v1/user/api-keys - Create new API key (raw key returned ONCE)
 *
 * Authentication: Session-only — API keys cannot mint or list other keys.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  CreateApiKeyRequestSchema,
  type ApiKeyResponse,
  type CreateApiKeyData,
  type ListApiKeysResponseData,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getApiKeyService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';
import type { ApiKeyRecord, CreatedApiKey } from '@midcurve/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeKey(key: ApiKeyRecord): ApiKeyResponse {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    createdAt: key.createdAt.toISOString(),
    expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
  };
}

function serializeCreated(key: CreatedApiKey): CreateApiKeyData {
  return {
    id: key.id,
    name: key.name,
    key: key.key,
    keyPrefix: key.keyPrefix,
    createdAt: key.createdAt.toISOString(),
    expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
  };
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/user/api-keys
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withAuth(
    request,
    async (user, requestId) => {
      const startTime = Date.now();

      const keys = await getApiKeyService().listUserKeys(user.id);

      const data: ListApiKeysResponseData = {
        keys: keys.map(serializeKey),
      };

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(createSuccessResponse(data), { status: 200 });
    },
    { sessionsOnly: true }
  );
}

/**
 * POST /api/v1/user/api-keys
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withAuth(
    request,
    async (user, requestId) => {
      const startTime = Date.now();

      const body = await request.json();
      const parseResult = CreateApiKeyRequestSchema.safeParse(body);

      if (!parseResult.success) {
        apiLog.validationError(apiLogger, requestId, parseResult.error.errors);
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(
          createErrorResponse(
            ApiErrorCode.VALIDATION_ERROR,
            'Invalid request body',
            parseResult.error.errors
          ),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] }
        );
      }

      const { name, expiresInDays } = parseResult.data;
      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const created = await getApiKeyService().createKey(user.id, name, expiresAt);

      apiLog.businessOperation(apiLogger, requestId, 'created', 'apiKey', created.id, {
        name,
        keyPrefix: created.keyPrefix,
        expiresAt: expiresAt?.toISOString() ?? null,
      });

      apiLog.requestEnd(apiLogger, requestId, 201, Date.now() - startTime);
      return NextResponse.json(createSuccessResponse(serializeCreated(created)), { status: 201 });
    },
    { sessionsOnly: true }
  );
}
