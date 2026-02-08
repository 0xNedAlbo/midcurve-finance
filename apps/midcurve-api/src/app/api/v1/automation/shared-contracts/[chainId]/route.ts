/**
 * Chain Shared Contracts Endpoint
 *
 * GET /api/v1/automation/shared-contracts/:chainId
 *   - Get shared automation contracts available on a specific chain
 *
 * No authentication required - this is public configuration data.
 * Use this when you only have a chainId and no nftId (e.g., before minting a position).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  type SharedContractsMap,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse, applyCorsHeaders } from '@/lib/cors';
import { getSharedContractService } from '@/lib/services';

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
 * GET /api/v1/automation/shared-contracts/:chainId
 *
 * Get shared contracts available for a chain.
 * Returns a map of contract names to contract info.
 *
 * Response:
 * {
 *   data: {
 *     contracts: {
 *       "UniswapV3PositionCloser": {
 *         chainId: 31337,
 *         contractAddress: "0x...",
 *         version: { major: 1, minor: 0 },
 *         sharedContractHash: "evm/uniswap-v3-position-closer/1/0"
 *       }
 *     }
 *   }
 * }
 *
 * An empty contracts map means no contracts are available for this chain.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  const requestId = request.headers.get('x-request-id') || 'unknown';
  const origin = request.headers.get('origin');
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
      return applyCorsHeaders(
        NextResponse.json(errorResponse, { status: 400 }),
        origin
      );
    }

    // Get shared contracts for this chain from database
    const sharedContractService = getSharedContractService();
    const contractsMap = await sharedContractService.findLatestContractsForChain(chainId);

    // Build response map
    const contracts: SharedContractsMap = {};
    for (const [name, contract] of contractsMap) {
      contracts[name] = {
        chainId: contract.config.chainId,
        contractAddress: contract.config.address,
        version: {
          major: contract.interfaceVersionMajor,
          minor: contract.interfaceVersionMinor,
        },
        sharedContractHash: contract.sharedContractHash,
      };
    }

    const response = createSuccessResponse({ contracts });
    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
    return applyCorsHeaders(
      NextResponse.json(response, { status: 200 }),
      origin
    );
  } catch (error) {
    apiLog.methodError(
      apiLogger,
      'GET /api/v1/automation/shared-contracts/[chainId]',
      error,
      { requestId }
    );
    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to retrieve shared contracts'
    );
    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
    return applyCorsHeaders(
      NextResponse.json(errorResponse, { status: 500 }),
      origin
    );
  }
}
