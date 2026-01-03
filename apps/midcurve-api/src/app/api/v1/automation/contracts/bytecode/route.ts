/**
 * Automation Contract Bytecode API Endpoint
 *
 * GET /api/v1/automation/contracts/bytecode - Get contract bytecode for user deployment
 *
 * Returns the UniswapV3PositionCloser bytecode and constructor args for the user
 * to deploy via their own wallet (Wagmi).
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
import { getPositionManagerAddress } from '@midcurve/services';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Signer service URL
const SIGNER_URL = process.env.SIGNER_URL || 'http://localhost:3003';
const SIGNER_INTERNAL_API_KEY = process.env.SIGNER_INTERNAL_API_KEY || '';

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
 * This is the first step in the user-signed deployment flow.
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

      // Get NFPM address for this chain
      let nfpmAddress: string;
      try {
        nfpmAddress = getPositionManagerAddress(chainId);
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Chain ${chainId} is not supported for Uniswap V3`
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Call signer service to get bytecode + operator address
      const signerResponse = await fetch(`${SIGNER_URL}/api/automation/contracts/bytecode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': SIGNER_INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          userId: user.id,
          chainId,
          nfpmAddress,
        }),
      });

      if (!signerResponse.ok) {
        const errorText = await signerResponse.text();
        apiLogger.error({
          requestId,
          status: signerResponse.status,
          error: errorText,
        }, 'Failed to get bytecode from signer');

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to get contract bytecode'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const signerData = await signerResponse.json();

      // Build response
      const response: GetContractBytecodeResponse = createSuccessResponse({
        bytecode: signerData.data.bytecode,
        constructorArgs: signerData.data.constructorArgs,
        contractType,
        chainId,
        nfpmAddress,
        operatorAddress: signerData.data.operatorAddress,
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
