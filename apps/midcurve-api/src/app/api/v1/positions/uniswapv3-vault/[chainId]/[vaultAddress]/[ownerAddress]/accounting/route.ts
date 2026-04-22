/**
 * Position Accounting Endpoint (Uniswap V3 Vault)
 *
 * GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/accounting
 *
 * Returns a lifetime-to-date, realized-only accounting report for a single
 * vault position: balance sheet, P&L breakdown, and the full journal entry
 * audit trail.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
  GetUniswapV3VaultPositionParamsSchema,
  type PositionAccountingResponse,
} from '@midcurve/api-shared';
import { normalizeAddress } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { getJournalService, getUniswapV3VaultPositionService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; vaultAddress: string; ownerAddress: string }> }
): Promise<Response> {
  return withAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const resolvedParams = await params;
      const validation = GetUniswapV3VaultPositionParamsSchema.safeParse(resolvedParams);

      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid path parameters',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR],
        });
      }

      const { chainId } = validation.data;
      const vaultAddress = normalizeAddress(validation.data.vaultAddress);
      const ownerAddress = normalizeAddress(validation.data.ownerAddress);
      const positionHash = `uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}`;

      const dbPosition = await getUniswapV3VaultPositionService().findByPositionHash(
        user.id,
        positionHash
      );

      if (!dbPosition) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.POSITION_NOT_FOUND,
          'Vault position not found',
          `No vault position found for chainId ${chainId} and vaultAddress ${vaultAddress}`
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, {
          status: ErrorCodeToHttpStatus[ApiErrorCode.POSITION_NOT_FOUND],
        });
      }

      const report: PositionAccountingResponse = await getJournalService()
        .getPositionAccountingReport(positionHash, user.id);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(createSuccessResponse(report), {
        status: 200,
        headers: { 'Cache-Control': 'private, no-cache' },
      });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/accounting',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to fetch vault position accounting report',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
