/**
 * Automation Contract Bytecode API Endpoint
 *
 * GET /api/v1/automation/contracts/bytecode - Get contract bytecode for user deployment
 *
 * Returns only the bytecode. Constructor args (nfpmAddress, operatorAddress) are
 * built client-side since they don't change frequently and the UI already has:
 * - NFPM addresses for all supported chains (for fee collection, etc.)
 * - Autowallet address from the user's profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  GetContractBytecodeQuerySchema,
  type GetContractBytecodeResponse,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Service URLs
const AUTOMATION_URL = process.env.AUTOMATION_URL || 'http://localhost:3004';

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/automation/contracts/bytecode
 *
 * Get contract bytecode for user to deploy automation contract.
 * Returns only bytecode - UI builds constructor args locally using:
 * - nfpmAddress: hardcoded per chain (UI already has these)
 * - operatorAddress: autowallet address (UI fetches from /api/v1/automation/wallet)
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse and validate query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        chainId: searchParams.get('chainId') ?? undefined,
        contractType: searchParams.get('contractType') ?? undefined,
      };

      const validation = GetContractBytecodeQuerySchema.safeParse(queryParams);
      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid query parameters',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const { chainId, contractType } = validation.data;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'get-bytecode',
        'automation-contract',
        user.id,
        { chainId, contractType }
      );

      // Only uniswapv3 supported for now
      if (contractType !== 'uniswapv3') {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Contract type '${contractType}' is not supported`
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Get bytecode from automation service (no auth needed)
      const bytecodeResponse = await fetch(
        `${AUTOMATION_URL}/api/contracts/bytecode?contractType=${contractType}`
      );

      if (!bytecodeResponse.ok) {
        const errorText = await bytecodeResponse.text();
        apiLogger.error({
          requestId,
          status: bytecodeResponse.status,
          error: errorText,
        }, 'Failed to get bytecode from automation service');

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to get contract bytecode'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const bytecodeData = await bytecodeResponse.json();
      if (!bytecodeData.success || !bytecodeData.data?.bytecode) {
        apiLogger.error({
          requestId,
          error: bytecodeData.error || 'Invalid response',
        }, 'Invalid bytecode response from automation service');

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to get contract bytecode'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // Build response - only bytecode, UI handles constructor args
      const response: GetContractBytecodeResponse = createSuccessResponse({
        bytecode: bytecodeData.data.bytecode,
        contractType,
        chainId,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/contracts/bytecode',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to get contract bytecode'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
