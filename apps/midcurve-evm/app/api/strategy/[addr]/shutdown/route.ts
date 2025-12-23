/**
 * Strategy Shutdown Lifecycle Endpoint
 *
 * POST /api/strategy/:addr/shutdown - Initiate shutdown operation
 * GET /api/strategy/:addr/shutdown - Poll operation status
 *
 * POST publishes LIFECYCLE_SHUTDOWN event, waits for on-chain transition,
 * stops the loop, and tears down RabbitMQ topology.
 * Returns 202 Accepted with Location header pointing to this same endpoint.
 * Client should poll GET on this endpoint until operationStatus is terminal.
 *
 * POST Response (202 Accepted):
 * Headers:
 *   Location: /api/strategy/{addr}/shutdown
 * Body:
 * {
 *   contractAddress: string,
 *   operation: "shutdown",
 *   operationStatus: "pending" | "publishing_event" | "waiting_for_transition" | ...
 * }
 *
 * GET Response (200 OK):
 * {
 *   contractAddress: string,
 *   operation: "shutdown",
 *   operationStatus: "pending" | "stopping_loop" | "completed" | "failed",
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

const log = logger.child({ route: '/api/strategy/:addr/shutdown' });

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

    log.info({ contractAddress, msg: 'Shutting down strategy' });

    // Get RabbitMQ channel
    const connectionManager = getRabbitMQConnection();
    const channel = await connectionManager.getChannel();

    // Start shutdown operation (non-blocking)
    const lifecycleService = getLifecycleService();
    const state = await lifecycleService.shutdownStrategy(contractAddress, channel);

    // Build status URL for Location header (same endpoint for polling)
    const statusUrl = `/api/strategy/${contractAddress}/shutdown`;

    // Return 202 Accepted with Location header
    return NextResponse.json(
      {
        contractAddress,
        operation: 'shutdown',
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
    log.error({ error, msg: 'Shutdown strategy error' });

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

    log.debug({ contractAddress, msg: 'Polling shutdown operation status' });

    // Check for active or recent lifecycle operation
    const lifecycleService = getLifecycleService();
    const state = lifecycleService.getOperationState(contractAddress);

    // If we have an active shutdown operation, return its status
    if (state && state.operation === 'shutdown') {
      return NextResponse.json({
        contractAddress,
        operation: 'shutdown',
        operationStatus: state.status,
        operationStartedAt: state.startedAt.toISOString(),
        operationCompletedAt: state.completedAt?.toISOString(),
        operationError: state.error,
      });
    }

    // No active shutdown operation - check if strategy is already shutdown (operation completed)
    const dbClient = getDatabaseClient();
    const strategy = await dbClient.getStrategyStatus(contractAddress);

    if (strategy?.status === 'shutdown') {
      // Strategy is shutdown, so shutdown operation must have completed
      return NextResponse.json({
        contractAddress,
        operation: 'shutdown',
        operationStatus: 'completed',
      });
    }

    // No active operation and strategy not shutdown - operation not found
    return NextResponse.json(
      { error: 'No shutdown operation found', code: 'OPERATION_NOT_FOUND' },
      { status: 404 }
    );
  } catch (error) {
    log.error({ error, msg: 'Error polling shutdown operation status' });

    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as any)?.statusCode ?? 500;
    const code = (error as any)?.code;

    return NextResponse.json(
      { error: message, code },
      { status: statusCode }
    );
  }
}
