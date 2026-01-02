/**
 * UniswapV3 Automation Contract by Chain API Endpoint
 *
 * GET /api/v1/automation/contracts/uniswapv3/chain/[chainId]
 *   - Get UniswapV3 automation contract for a specific chain
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  type GetContractByChainResponse,
} from '@midcurve/api-shared';
import { serializeAutomationContract } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getAutomationContractService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{
    chainId: string;
  }>;
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/automation/contracts/uniswapv3/chain/[chainId]
 *
 * Get the UniswapV3 automation contract for a specific chain.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const { chainId: chainIdStr } = await params;
      const chainId = parseInt(chainIdStr, 10);

      // Validate chainId is a positive integer
      if (isNaN(chainId) || chainId <= 0) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid chainId: must be a positive integer'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'get',
        'automation-contract',
        user.id,
        { contractType: 'uniswapv3', chainId }
      );

      // Fetch contract
      const contractService = getAutomationContractService();
      const contract = await contractService.findByUserAndChain(
        user.id,
        'uniswapv3',
        chainId
      );

      if (!contract) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          `No UniswapV3 automation contract found for chain ${chainId}`
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 404 });
      }

      // Serialize and return
      const serialized = serializeAutomationContract(contract);
      const response: GetContractByChainResponse = createSuccessResponse(serialized);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/contracts/uniswapv3/chain/[chainId]',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve automation contract'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
