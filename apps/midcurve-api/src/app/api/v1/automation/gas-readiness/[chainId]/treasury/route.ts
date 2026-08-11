/**
 * Treasury Registration Endpoint
 *
 * POST /api/v1/automation/gas-readiness/:chainId/treasury
 *   - Register a freshly deployed MidcurveTreasury so this environment can
 *     find it. Until the row exists, the fee recipient resolves to the zero
 *     address and nothing accrues.
 *
 * The address comes from the caller because a plain CREATE deployment gives
 * nothing to derive it from. Every property that makes the contract *this
 * environment's* treasury is verified on chain before the row is written —
 * see GasReadinessService.registerTreasury. A caller cannot register an
 * address of their choosing.
 *
 * Idempotent: registering the same address twice updates the same row.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  RegisterTreasuryBodySchema,
  type RegisterTreasuryResponseData,
} from '@midcurve/api-shared';
import { TreasuryRegistrationRejectedError } from '@midcurve/services';
import { withAuth } from '@/middleware/with-auth';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse, applyCorsHeaders } from '@/lib/cors';
import { getGasReadinessService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ chainId: string }>;
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/automation/gas-readiness/:chainId/treasury
 *
 * Body: { address: "0x..." } — from the deploy transaction receipt.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const origin = request.headers.get('origin');
    const startTime = Date.now();

    try {
      apiLog.requestStart(apiLogger, requestId, request);

      const { chainId: chainIdStr } = await params;
      const chainId = parseInt(chainIdStr, 10);

      if (isNaN(chainId) || chainId <= 0) {
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return applyCorsHeaders(
          NextResponse.json(
            createErrorResponse(
              ApiErrorCode.VALIDATION_ERROR,
              'Invalid chainId: must be a positive integer',
            ),
            { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] },
          ),
          origin,
        );
      }

      const body = await request.json();
      const parsed = RegisterTreasuryBodySchema.safeParse(body);

      if (!parsed.success) {
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return applyCorsHeaders(
          NextResponse.json(
            createErrorResponse(
              ApiErrorCode.VALIDATION_ERROR,
              parsed.error.issues[0]?.message ?? 'Invalid request body',
            ),
            { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] },
          ),
          origin,
        );
      }

      const result = await getGasReadinessService().registerTreasury({
        chainId,
        address: parsed.data.address,
      });

      apiLogger.info(
        { requestId, userId: user.id, chainId, address: result.address },
        'Treasury registered from the close-order flow',
      );

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return applyCorsHeaders(
        NextResponse.json(
          createSuccessResponse<RegisterTreasuryResponseData>(result),
          { status: 200 },
        ),
        origin,
      );
    } catch (error) {
      // A rejected registration is the caller's problem, not the server's:
      // the address has no code, or the contract there is not this
      // environment's treasury. Say which, so a resumed kickstart that
      // submitted the wrong address is diagnosable.
      if (error instanceof TreasuryRegistrationRejectedError) {
        apiLogger.warn(
          { requestId, userId: user.id, reason: error.reason, msg: error.message },
          'Treasury registration rejected',
        );
        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);
        return applyCorsHeaders(
          NextResponse.json(
            createErrorResponse(ApiErrorCode.CONFLICT, error.message),
            { status: ErrorCodeToHttpStatus[ApiErrorCode.CONFLICT] },
          ),
          origin,
        );
      }

      apiLog.methodError(
        apiLogger,
        'POST /api/v1/automation/gas-readiness/[chainId]/treasury',
        error,
        { requestId },
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return applyCorsHeaders(
        NextResponse.json(
          createErrorResponse(
            ApiErrorCode.INTERNAL_SERVER_ERROR,
            'Failed to register treasury',
          ),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR] },
        ),
        origin,
      );
    }
  });
}
