/**
 * Automation Contract Notify API Endpoint
 *
 * POST /api/v1/automation/contracts/notify - Notify API of user-deployed contract
 *
 * Called after user deploys automation contract via their wallet.
 * Creates/updates the contract record with deployment information.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  NotifyContractDeployedRequestSchema,
  type NotifyContractDeployedResponse,
} from '@midcurve/api-shared';
import { getPositionManagerAddress } from '@midcurve/services';
import { serializeAutomationContract } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getAutomationContractService } from '@/lib/services';
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
 * POST /api/v1/automation/contracts/notify
 *
 * Notify API that user has deployed an automation contract.
 * This creates/updates the contract record in the database.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse JSON body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Validate request
      const validation = NotifyContractDeployedRequestSchema.safeParse(body);
      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const { chainId, contractType, contractAddress, txHash } = validation.data;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'notify-deployed',
        'automation-contract',
        user.id,
        { chainId, contractType, contractAddress, txHash }
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

      // Get operator address from signer (no RPC, just database lookup)
      let operatorAddress: string;
      try {
        const signerResponse = await fetch(
          `${SIGNER_URL}/api/wallets/automation?userId=${encodeURIComponent(user.id)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${SIGNER_INTERNAL_API_KEY}`,
            },
          }
        );

        if (!signerResponse.ok) {
          throw new Error('Failed to get operator address');
        }

        const signerData = await signerResponse.json();
        if (!signerData.wallet?.walletAddress) {
          throw new Error('No autowallet found for user');
        }
        operatorAddress = signerData.wallet.walletAddress;
      } catch (error) {
        apiLogger.error({
          requestId,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to get operator address from signer');

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to verify operator address'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const contractService = getAutomationContractService();

      // Check if contract record already exists
      let contract = await contractService.findByUserAndChain(
        user.id,
        contractType,
        chainId
      );

      if (contract) {
        // Update existing record with deployment info
        contract = await contractService.markDeployed(contract.id, {
          contractAddress,
          deploymentTxHash: txHash,
          operatorAddress,
          nfpmAddress,
        });

        apiLogger.info({
          requestId,
          contractId: contract.id,
          contractAddress,
        }, 'Updated existing contract with deployment info');
      } else {
        // Create new record and mark as deployed
        contract = await contractService.create({
          userId: user.id,
          contractType,
          chainId,
        });

        contract = await contractService.markDeployed(contract.id, {
          contractAddress,
          deploymentTxHash: txHash,
          operatorAddress,
          nfpmAddress,
        });

        apiLogger.info({
          requestId,
          contractId: contract.id,
          contractAddress,
        }, 'Created new contract record with deployment info');
      }

      // Serialize and return
      const serializedContract = serializeAutomationContract(contract);
      const response: NotifyContractDeployedResponse = createSuccessResponse(serializedContract);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/automation/contracts/notify',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to record contract deployment'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
