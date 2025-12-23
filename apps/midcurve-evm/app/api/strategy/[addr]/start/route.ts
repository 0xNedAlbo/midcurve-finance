/**
 * Strategy Start Lifecycle Endpoint
 *
 * POST /api/strategy/:addr/start - Initiate start operation
 * GET /api/strategy/:addr/start - Poll operation status
 *
 * POST creates a StrategyLoop, starts it, and publishes LIFECYCLE_START event.
 * Returns 202 Accepted with Location header pointing to this same endpoint.
 * Client should poll GET on this endpoint until operationStatus is terminal.
 *
 * POST Response (202 Accepted):
 * Headers:
 *   Location: /api/strategy/{addr}/start
 * Body:
 * {
 *   contractAddress: string,
 *   operation: "start",
 *   operationStatus: "pending" | "starting_loop" | "publishing_event"
 * }
 *
 * GET Response (200 OK):
 * {
 *   contractAddress: string,
 *   operation: "start",
 *   operationStatus: "pending" | "starting_loop" | "completed" | "failed",
 *   operationStartedAt?: string,
 *   operationCompletedAt?: string,
 *   operationError?: string
 * }
 *
 * Response (4xx):
 * {
 *   error: string,
 *   code?: string
 * }
 */

import { NextResponse } from 'next/server';
import type { Address } from 'viem';
import { getLifecycleService } from '../../../../../core/src/services/lifecycle-service';
import { getRabbitMQConnection } from '../../../../../core/src/mq/connection';
import { getDatabaseClient } from '../../../../../core/src/clients/database-client';
import { logger } from '../../../../../lib/logger';

const log = logger.child({ route: '/api/strategy/:addr/start' });

// =============================================================================
// Handler
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ addr: string }> }
) {
  try {
    const { addr } = await params;
    const contractAddress = addr.toLowerCase() as Address;

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      return NextResponse.json(
        { error: 'Invalid contract address', code: 'INVALID_ADDRESS' },
        { status: 400 }
      );
    }

    log.info({ contractAddress, msg: 'Starting strategy' });

    // Get RabbitMQ channel
    const connectionManager = getRabbitMQConnection();
    const channel = await connectionManager.getChannel();

    // Start lifecycle operation (non-blocking)
    const lifecycleService = getLifecycleService();
    const state = await lifecycleService.startStrategy(contractAddress, channel);

    // Build status URL for Location header (same endpoint for polling)
    const statusUrl = `/api/strategy/${contractAddress}/start`;

    // Return 202 Accepted with Location header
    return NextResponse.json(
      {
        contractAddress,
        operation: 'start',
        operationStatus: state.status,
      },
      {
        status: 202,
        headers: {
          Location: statusUrl,
        },
      }
    );
  } catch (error) {
    log.error({ error, msg: 'Start strategy error' });

    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as any)?.statusCode ?? 500;
    const code = (error as any)?.code;

    return NextResponse.json(
      { error: message, code },
      { status: statusCode }
    );
  }
}

// =============================================================================
// GET Handler - Poll operation status
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ addr: string }> }
) {
  try {
    const { addr } = await params;
    const contractAddress = addr.toLowerCase() as Address;

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      return NextResponse.json(
        { error: 'Invalid contract address', code: 'INVALID_ADDRESS' },
        { status: 400 }
      );
    }

    log.debug({ contractAddress, msg: 'Polling start operation status' });

    // Check for active or recent lifecycle operation
    const lifecycleService = getLifecycleService();
    const state = lifecycleService.getOperationState(contractAddress);

    // If we have an active start operation, return its status
    if (state && state.operation === 'start') {
      return NextResponse.json({
        contractAddress,
        operation: 'start',
        operationStatus: state.status,
        operationStartedAt: state.startedAt.toISOString(),
        operationCompletedAt: state.completedAt?.toISOString(),
        operationError: state.error,
      });
    }

    // No active start operation - check if strategy is already active (operation completed)
    const dbClient = getDatabaseClient();
    const strategy = await dbClient.getStrategyStatus(contractAddress);

    if (strategy?.status === 'active') {
      // Strategy is active, so start operation must have completed
      return NextResponse.json({
        contractAddress,
        operation: 'start',
        operationStatus: 'completed',
      });
    }

    // No active operation and strategy not active - operation not found
    return NextResponse.json(
      { error: 'No start operation found', code: 'OPERATION_NOT_FOUND' },
      { status: 404 }
    );
  } catch (error) {
    log.error({ error, msg: 'Error polling start operation status' });

    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as any)?.statusCode ?? 500;
    const code = (error as any)?.code;

    return NextResponse.json(
      { error: message, code },
      { status: statusCode }
    );
  }
}
