/**
 * Shared Contract by Chain API Endpoint
 *
 * GET /api/v1/automation/shared-contracts/[chainId]
 *   - Get the shared contract configuration for a specific chain
 *
 * No authentication required - this is public configuration data.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';
import {
  isChainSupported,
  getSharedContractConfig,
} from '@/config/shared-contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{
    chainId: string;
  }>;
}

/**
 * Shared contract info for a specific chain
 */
interface SharedContractInfo {
  chainId: number;
  contractAddress: string;
  positionManager: string;
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/automation/shared-contracts/[chainId]
 *
 * Get the shared contract configuration for a specific chain.
 * Currently only supports UniswapV3 protocol.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  const requestId = request.headers.get('x-request-id') || 'unknown';
  const startTime = Date.now();

  try {
    const { chainId: chainIdStr } = await params;
    const chainId = parseInt(chainIdStr, 10);

    apiLog.requestStart(apiLogger, requestId, request);

    // Validate chainId is a positive integer
    if (isNaN(chainId) || chainId <= 0) {
      const errorResponse = createErrorResponse(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid chainId: must be a positive integer'
      );
      apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if chain is supported for UniswapV3
    if (!isChainSupported('uniswapv3', chainId)) {
      const errorResponse = createErrorResponse(
        ApiErrorCode.NOT_FOUND,
        `No shared contract available for chain ${chainId}`
      );
      apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Get the contract config
    const config = getSharedContractConfig('uniswapv3', chainId);
    const result: SharedContractInfo = {
      chainId,
      contractAddress: config.contractAddress,
      positionManager: config.positionManager,
    };

    const response = createSuccessResponse(result);
    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    apiLog.methodError(
      apiLogger,
      'GET /api/v1/automation/shared-contracts/[chainId]',
      error,
      { requestId }
    );
    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to retrieve shared contract'
    );
    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
