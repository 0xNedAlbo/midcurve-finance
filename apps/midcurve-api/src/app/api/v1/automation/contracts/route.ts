/**
 * Automation Contracts API Endpoints
 *
 * POST /api/v1/automation/contracts - Deploy new automation contract
 * GET /api/v1/automation/contracts - List user's contracts
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  DeployContractRequestSchema,
  ListContractsQuerySchema,
  type DeployContractResponse,
  type ListContractsResponse,
} from '@midcurve/api-shared';
import { serializeAutomationContract } from '@/lib/serializers';
import { apiLogger, apiLog } from '@/lib/logger';
import { getAutomationContractService } from '@/lib/services';
import { createPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/automation/contracts
 *
 * Deploy a new automation contract for the authenticated user.
 * Returns 202 Accepted with a poll URL for deployment status.
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
      const validation = DeployContractRequestSchema.safeParse(body);
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

      const { contractType, chainId } = validation.data;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'deploy',
        'automation-contract',
        user.id,
        { contractType, chainId }
      );

      // Check if contract already exists for this user + chain + contractType
      const contractService = getAutomationContractService();
      const existingContract = await contractService.findByUserAndChain(
        user.id,
        contractType,
        chainId
      );

      if (existingContract) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.CONFLICT,
          `Automation contract already exists for ${contractType} on chain ${chainId}`
        );
        apiLog.requestEnd(apiLogger, requestId, 409, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 409 });
      }

      // Create contract record (pending deployment)
      const contract = await contractService.create({
        userId: user.id,
        contractType,
        chainId,
      });

      // Build poll URL
      const pollUrl = `/api/v1/automation/contracts/${contract.id}/status`;

      // Return 202 Accepted with polling info
      const response: DeployContractResponse = createSuccessResponse({
        id: contract.id,
        contractType: contract.contractType,
        chainId,
        operationStatus: 'pending',
        pollUrl,
      });

      apiLog.requestEnd(apiLogger, requestId, 202, Date.now() - startTime);
      return NextResponse.json(response, {
        status: 202,
        headers: { Location: pollUrl },
      });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/automation/contracts',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to create automation contract'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}

/**
 * GET /api/v1/automation/contracts
 *
 * List all automation contracts for the authenticated user.
 * Supports filtering by contractType, chainId, and isActive.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse and validate query parameters
      const { searchParams } = new URL(request.url);
      const queryParams = {
        contractType: searchParams.get('contractType') ?? undefined,
        chainId: searchParams.get('chainId') ?? undefined,
        isActive: searchParams.get('isActive') ?? undefined,
      };

      const validation = ListContractsQuerySchema.safeParse(queryParams);
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

      const { contractType, chainId, isActive } = validation.data;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'list',
        'automation-contracts',
        user.id,
        { contractType, chainId, isActive }
      );

      // Fetch contracts
      const contractService = getAutomationContractService();
      const contracts = await contractService.findByUserId(user.id, {
        contractType,
        chainId,
        isActive,
      });

      // Serialize contracts
      const serializedContracts = contracts.map(serializeAutomationContract);

      // Build response
      const response: ListContractsResponse = createSuccessResponse(serializedContracts);

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/automation/contracts',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve automation contracts'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
