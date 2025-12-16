/**
 * GET /api/strategy/:addr - Get strategy status
 *
 * Returns the current status of a deployed strategy including:
 * - Database status
 * - Loop status (if running)
 * - Deployment/lifecycle operation status (if in progress)
 *
 * Response (200 - stable state):
 * {
 *   id: string,
 *   contractAddress: string,
 *   status: "deployed" | "active" | "shutdown",
 *   chainId: number,
 *   loopRunning: boolean,
 *   epoch?: number,
 *   eventsProcessed?: number,
 *   effectsProcessed?: number
 * }
 *
 * Response (202 - operation in progress):
 * {
 *   contractAddress: string,
 *   status: "deploying" | "starting" | "shutting_down",
 *   operation?: { status: string, startedAt: string }
 * }
 *
 * Response (4xx/5xx):
 * {
 *   error: string,
 *   code?: string
 * }
 */

import { NextResponse } from 'next/server';
import type { Address } from 'viem';
import { getDatabaseClient } from '../../../../core/src/clients/database-client';
import { getDeploymentService } from '../../../../core/src/services/deployment-service';
import { getLifecycleService } from '../../../../core/src/services/lifecycle-service';
import { logger } from '../../../../lib/logger';

const log = logger.child({ route: 'GET /api/strategy/:addr' });

// =============================================================================
// Handler
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ addr: string }> }
) {
  try {
    const { addr } = await params;
    const contractAddress = addr.toLowerCase() as Address;

    log.info({ contractAddress, msg: 'Getting strategy status' });

    // Check for active lifecycle operation first
    const lifecycleService = getLifecycleService();
    const lifecycleOp = lifecycleService.getOperationState(contractAddress);

    if (lifecycleOp && !['completed', 'failed'].includes(lifecycleOp.status)) {
      // Operation in progress
      return NextResponse.json(
        {
          contractAddress,
          operation: lifecycleOp.operation,
          operationStatus: lifecycleOp.status,
          startedAt: lifecycleOp.startedAt.toISOString(),
          error: lifecycleOp.error,
        },
        { status: 202 }
      );
    }

    // Check database for strategy status
    const dbClient = getDatabaseClient();
    const strategy = await dbClient.getStrategyStatus(contractAddress);

    if (!strategy) {
      // Check if there's a deployment in progress for this address
      // (would need to search by contract address in deployment states)
      return NextResponse.json(
        { error: 'Strategy not found', code: 'STRATEGY_NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get loop info if active
    const loopInfo = lifecycleService.getLoopInfo(contractAddress);

    // Determine response status code
    // 200 for stable states, 202 for transitional states
    const isStableState = ['deployed', 'active', 'shutdown'].includes(strategy.status);
    const statusCode = isStableState ? 200 : 202;

    return NextResponse.json(
      {
        id: strategy.id,
        contractAddress: strategy.contractAddress,
        status: strategy.status,
        chainId: strategy.chainId,
        createdAt: strategy.createdAt.toISOString(),
        ...loopInfo,
      },
      { status: statusCode }
    );
  } catch (error) {
    log.error({ error, msg: 'Error getting strategy status' });

    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as any)?.statusCode ?? 500;
    const code = (error as any)?.code;

    return NextResponse.json(
      { error: message, code },
      { status: statusCode }
    );
  }
}
