/**
 * Automation Contract Status API Endpoint
 *
 * GET /api/v1/automation/contracts/[id]/status
 *   - Poll for contract deployment status
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  type GetContractStatusResponse,
} from '@midcurve/api-shared';
import { serializeAutomationContract } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getAutomationContractService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/automation/contracts/[id]/status
 *
 * Poll for the deployment status of an automation contract.
 * Always returns 200 OK - check operationStatus in body for actual status.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      const { id } = await params;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'poll-status',
        'automation-contract',
        user.id,
        { contractId: id }
      );

      // Fetch contract
      const contractService = getAutomationContractService();
      const contract = await contractService.findById(id);

      if (!contract) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          `Automation contract not found: ${id}`
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 404 });
      }

      // Verify ownership
      if (contract.userId !== user.id) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.FORBIDDEN,
          'You do not have access to this contract'
        );
        apiLog.requestEnd(apiLogger, requestId, 403, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 403 });
      }

      // Determine operation status based on contract state
      // For UniswapV3 contracts, check if contractAddress is set
      const contractState = contract.state as Record<string, unknown>;
      const contractConfig = contract.config as { chainId: number };
      const hasContractAddress = 'contractAddress' in contractState &&
        contractState.contractAddress !== null &&
        contractState.contractAddress !== '';

      let operationStatus: 'pending' | 'deploying' | 'completed' | 'failed';

      if (hasContractAddress) {
        operationStatus = 'completed';
      } else if (!contract.isActive) {
        operationStatus = 'failed';
      } else {
        // Contract is active but not yet deployed
        operationStatus = 'pending';
      }

      // Build response
      const response: GetContractStatusResponse = createSuccessResponse({
        id: contract.id,
        contractType: contract.contractType,
        chainId: contractConfig.chainId,
        operationStatus,
        contract: operationStatus === 'completed'
          ? serializeAutomationContract(contract)
          : undefined,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/contracts/[id]/status',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve contract status'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
