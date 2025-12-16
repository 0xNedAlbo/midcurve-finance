/**
 * POST /api/strategy/:addr/start - Start a strategy
 *
 * Creates a StrategyLoop, starts it, and publishes LIFECYCLE_START event.
 *
 * Returns 202 immediately. Poll GET /api/strategy/:addr for status.
 *
 * Response (202):
 * {
 *   contractAddress: string,
 *   status: "pending" | "starting_loop" | "publishing_event",
 *   pollUrl: "/api/strategy/{addr}"
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
import { getLifecycleService } from '../../../../../core/src/services/lifecycle-service';
import { getRabbitMQConnection } from '../../../../../core/src/mq/connection';
import { logger } from '../../../../../lib/logger';

const log = logger.child({ route: 'POST /api/strategy/:addr/start' });

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

    // Return 202 with polling info
    const pollUrl = `/api/strategy/${contractAddress}`;

    // Determine status code based on state
    const statusCode = state.status === 'completed' ? 200 :
                       state.status === 'failed' ? 500 : 202;

    return NextResponse.json(
      {
        contractAddress,
        operation: 'start',
        status: state.status,
        startedAt: state.startedAt.toISOString(),
        completedAt: state.completedAt?.toISOString(),
        error: state.error,
        pollUrl,
      },
      { status: statusCode }
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
