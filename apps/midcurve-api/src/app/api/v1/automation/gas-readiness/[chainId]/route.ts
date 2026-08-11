/**
 * Gas Readiness Endpoint
 *
 * GET /api/v1/automation/gas-readiness/:chainId
 *   - Can this environment's automation pay to execute a close order on this
 *     chain, and if not, which steps are missing?
 *
 * Consulted by every close-order registration flow before the user registers.
 * Authenticated but not admin-gated: any user may kickstart a chain, and no
 * user gains control over the treasury's funds by doing so — the admin address
 * is fixed environment configuration.
 *
 * The frontend must not read chain state directly, so the operator balance,
 * the connected wallet's balance and the treasury's operator binding are all
 * read here.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  GasReadinessQuerySchema,
  type GasReadinessData,
} from '@midcurve/api-shared';
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
 * GET /api/v1/automation/gas-readiness/:chainId
 *
 * Query parameters:
 * - walletAddress (optional): the connected wallet, so the funding step can be
 *   disabled with a reason when it cannot afford the transfer
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  return withAuth(request, async (_user, requestId) => {
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

      const { searchParams } = new URL(request.url);
      const query = GasReadinessQuerySchema.safeParse({
        walletAddress: searchParams.get('walletAddress') ?? undefined,
      });

      if (!query.success) {
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return applyCorsHeaders(
          NextResponse.json(
            createErrorResponse(
              ApiErrorCode.VALIDATION_ERROR,
              query.error.issues[0]?.message ?? 'Invalid query parameters',
            ),
            { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] },
          ),
          origin,
        );
      }

      const readiness = await getGasReadinessService().getReadiness(
        chainId,
        query.data.walletAddress,
      );

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return applyCorsHeaders(
        NextResponse.json(
          createSuccessResponse<GasReadinessData>(readiness),
          { status: 200 },
        ),
        origin,
      );
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/gas-readiness/[chainId]',
        error,
        { requestId },
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return applyCorsHeaders(
        NextResponse.json(
          createErrorResponse(
            ApiErrorCode.INTERNAL_SERVER_ERROR,
            'Failed to determine gas readiness',
          ),
          { status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR] },
        ),
        origin,
      );
    }
  });
}
