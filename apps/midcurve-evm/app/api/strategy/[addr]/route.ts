/**
 * GET /api/strategy/:addr - Get strategy status
 *
 * Returns the current status of a deployed strategy including:
 * - Database status
 * - Loop status (if running)
 * - Lifecycle operation status (if in progress)
 *
 * Following REST async pattern: GET always returns 200 with status in body.
 * The operationStatus field indicates if an operation is running/completed/failed.
 *
 * Response (200):
 * {
 *   id?: string,
 *   contractAddress: string,
 *   status: "deployed" | "active" | "shutdown",
 *   chainId?: number,
 *   loopRunning?: boolean,
 *   // If lifecycle operation in progress or recently completed:
 *   operation?: "start" | "shutdown",
 *   operationStatus?: "pending" | "running" | "completed" | "failed",
 *   operationStartedAt?: string,
 *   operationCompletedAt?: string,
 *   operationError?: string
 * }
 *
 * Response (404):
 * {
 *   error: string,
 *   code: "STRATEGY_NOT_FOUND"
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

    // Check database for strategy status first
    const dbClient = getDatabaseClient();
    const strategy = await dbClient.getStrategyStatus(contractAddress);

    if (!strategy) {
      return NextResponse.json(
        { error: 'Strategy not found', code: 'STRATEGY_NOT_FOUND' },
        { status: 404 }
      );
    }

    // Check for active or recent lifecycle operation
    const lifecycleService = getLifecycleService();
    const lifecycleOp = lifecycleService.getOperationState(contractAddress);

    // Get loop info if active
    const loopInfo = lifecycleService.getLoopInfo(contractAddress);

    // Build response - always 200 OK with status in body
    const response: Record<string, unknown> = {
      id: strategy.id,
      contractAddress: strategy.contractAddress,
      status: strategy.status,
      chainId: strategy.chainId,
      createdAt: strategy.createdAt.toISOString(),
      ...loopInfo,
    };

    // Include lifecycle operation info if present
    if (lifecycleOp) {
      response.operation = lifecycleOp.operation;
      response.operationStatus = lifecycleOp.status;
      response.operationStartedAt = lifecycleOp.startedAt.toISOString();
      if (lifecycleOp.completedAt) {
        response.operationCompletedAt = lifecycleOp.completedAt.toISOString();
      }
      if (lifecycleOp.error) {
        response.operationError = lifecycleOp.error;
      }
    }

    return NextResponse.json(response, { status: 200 });
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
