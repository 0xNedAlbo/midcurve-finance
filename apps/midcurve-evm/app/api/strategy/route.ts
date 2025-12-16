/**
 * PUT /api/strategy - Deploy a strategy contract
 *
 * Request body:
 * {
 *   strategyId: string,
 *   ownerAddress: string    // 0x... address
 * }
 *
 * Note: chainId is not configurable - we only support local SEMSEE (31337)
 *
 * Returns 202 immediately. Poll GET /api/strategy/:addr for status.
 *
 * Response (202):
 * {
 *   strategyId: string,
 *   status: "pending" | "signing" | "broadcasting" | "confirming" | "setting_up_topology",
 *   pollUrl: "/api/strategy/{predictedAddress}"
 * }
 *
 * Response (4xx/5xx):
 * {
 *   error: string,
 *   code?: string
 * }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Address } from 'viem';
import { getDeploymentService } from '../../../core/src/services/deployment-service';
import { getRabbitMQConnection } from '../../../core/src/mq/connection';
import { logger } from '../../../lib/logger';

const log = logger.child({ route: 'PUT /api/strategy' });

// =============================================================================
// Request Schema
// =============================================================================

const DeployRequestSchema = z.object({
  strategyId: z.string().min(1),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

// =============================================================================
// Handler
// =============================================================================

export async function PUT(request: Request) {
  try {
    // Parse and validate request
    const body = await request.json();
    const parseResult = DeployRequestSchema.safeParse(body);

    if (!parseResult.success) {
      log.warn({ errors: parseResult.error.errors, msg: 'Invalid request' });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { strategyId, ownerAddress } = parseResult.data;

    log.info({ strategyId, msg: 'Starting deployment' });

    // Get RabbitMQ channel
    const connectionManager = getRabbitMQConnection();
    const channel = await connectionManager.getChannel();

    // Start deployment (non-blocking)
    const deploymentService = getDeploymentService();
    const state = await deploymentService.startDeployment(
      {
        strategyId,
        ownerAddress: ownerAddress as Address,
      },
      channel
    );

    // Return 202 with polling info
    const pollUrl = state.contractAddress
      ? `/api/strategy/${state.contractAddress}`
      : `/api/strategy?strategyId=${strategyId}`;

    return NextResponse.json(
      {
        strategyId,
        status: state.status,
        contractAddress: state.contractAddress,
        txHash: state.txHash,
        pollUrl,
      },
      { status: 202 }
    );
  } catch (error) {
    log.error({ error, msg: 'Deployment error' });

    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as any)?.statusCode ?? 500;
    const code = (error as any)?.code;

    return NextResponse.json(
      { error: message, code },
      { status: statusCode }
    );
  }
}

/**
 * GET /api/strategy?strategyId=xxx - Poll deployment status by strategy ID
 *
 * Used when we don't yet have a contract address (deployment in progress).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const strategyId = searchParams.get('strategyId');

    if (!strategyId) {
      return NextResponse.json(
        { error: 'strategyId query parameter required' },
        { status: 400 }
      );
    }

    const deploymentService = getDeploymentService();
    const state = deploymentService.getDeploymentState(strategyId);

    if (!state) {
      return NextResponse.json(
        { error: 'No deployment found for this strategy' },
        { status: 404 }
      );
    }

    // If completed, return 200; otherwise 202
    const statusCode = state.status === 'completed' ? 200 :
                       state.status === 'failed' ? 500 : 202;

    return NextResponse.json(
      {
        strategyId: state.strategyId,
        status: state.status,
        contractAddress: state.contractAddress,
        txHash: state.txHash,
        startedAt: state.startedAt.toISOString(),
        completedAt: state.completedAt?.toISOString(),
        error: state.error,
      },
      { status: statusCode }
    );
  } catch (error) {
    log.error({ error, msg: 'Error getting deployment status' });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
