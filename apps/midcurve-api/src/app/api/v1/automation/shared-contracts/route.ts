/**
 * Shared Contracts API Endpoint
 *
 * GET /api/v1/automation/shared-contracts
 *   - Get all shared contract configurations
 *
 * These are the pre-deployed shared contracts that users register orders with.
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
  getSupportedChains,
  getSharedContractConfig,
  SUPPORTED_PROTOCOLS,
  type CloseOrderProtocol,
} from '@/config/shared-contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Shared contract info for a specific chain
 */
interface SharedContractInfo {
  chainId: number;
  contractAddress: string;
  positionManager: string;
}

/**
 * Response data for GET /api/v1/automation/shared-contracts
 */
interface GetSharedContractsResponseData {
  uniswapv3: SharedContractInfo[];
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/automation/shared-contracts
 *
 * Get all shared contract configurations.
 * Returns contracts grouped by protocol.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get('x-request-id') || 'unknown';
  const startTime = Date.now();

  try {
    apiLog.requestStart(apiLogger, requestId, request);

    const result: GetSharedContractsResponseData = {
      uniswapv3: [],
    };

    // Build response for each supported protocol
    for (const protocol of SUPPORTED_PROTOCOLS) {
      const supportedChains = getSupportedChains(protocol);

      for (const chainId of supportedChains) {
        const config = getSharedContractConfig(protocol, chainId);
        result[protocol as CloseOrderProtocol].push({
          chainId,
          contractAddress: config.contractAddress,
          positionManager: config.positionManager,
        });
      }
    }

    const response = createSuccessResponse(result);
    apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    apiLog.methodError(
      apiLogger,
      'GET /api/v1/automation/shared-contracts',
      error,
      { requestId }
    );
    const errorResponse = createErrorResponse(
      ApiErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to retrieve shared contracts'
    );
    apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
