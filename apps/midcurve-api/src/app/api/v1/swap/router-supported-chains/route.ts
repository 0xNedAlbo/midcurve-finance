/**
 * Router Supported Chains Endpoint
 *
 * GET /api/v1/swap/router-supported-chains
 *   - Get all chains that have the MidcurveSwapRouter deployed
 *
 * No authentication required - this is public configuration data.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  type RouterSupportedChainsData,
} from '@midcurve/api-shared';
import { SharedContractNameEnum } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse, applyCorsHeaders } from '@/lib/cors';
import { getSharedContractService } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/swap/router-supported-chains
 *
 * Returns all chains that have an active MidcurveSwapRouter contract deployed.
 * Used by the SwapDialog to populate the chain selector.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get('x-request-id') || 'unknown';
  const origin = request.headers.get('origin');
  const startTime = Date.now();

  try {
    apiLog.requestStart(apiLogger, requestId, request);

    const sharedContractService = getSharedContractService();
    const chains = await sharedContractService.findChainsByContractName(
      SharedContractNameEnum.MIDCURVE_SWAP_ROUTER
    );

    const data: RouterSupportedChainsData = chains.map((c) => ({
      chainId: c.chainId,
      swapRouterAddress: c.address,
    }));

    const response = createSuccessResponse(data, {
      timestamp: new Date().toISOString(),
    });

    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
    return applyCorsHeaders(
      NextResponse.json(response, { status: 200 }),
      origin
    );
  } catch (error) {
    apiLog.methodError(
      apiLogger,
      'GET /api/v1/swap/router-supported-chains',
      error,
      { requestId }
    );
    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to retrieve supported chains'
    );
    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
    return applyCorsHeaders(
      NextResponse.json(errorResponse, { status: 500 }),
      origin
    );
  }
}
