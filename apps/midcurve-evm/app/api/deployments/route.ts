/**
 * POST /api/deployments - Deploy a strategy contract
 *
 * Request body:
 * {
 *   strategyId: string
 * }
 *
 * Note: chainId is not configurable - we only support local SEMSEE (31337)
 * Note: Constructor params are sourced from manifest (operator-address, core-address, user-input)
 *
 * Returns 202 Accepted with Location header pointing to status endpoint.
 * Poll GET /api/deployments/{strategyId} for status.
 *
 * Response (202):
 * Headers:
 *   Location: /api/deployments/{strategyId}
 * Body:
 * {
 *   strategyId: string,
 *   status: "pending",
 *   createdAt: string (ISO)
 * }
 *
 * Response (4xx):
 * {
 *   error: string,
 *   code?: string
 * }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDeploymentService } from '../../../core/src/services/deployment-service';
import { getRabbitMQConnection } from '../../../core/src/mq/connection';
import { logger } from '../../../lib/logger';

const log = logger.child({ route: 'POST /api/deployments' });

// =============================================================================
// Request Schema
// =============================================================================

const DeployRequestSchema = z.object({
  strategyId: z.string().min(1),
});

// =============================================================================
// Handler
// =============================================================================

export async function POST(request: Request) {
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

    // deploymentId is the unique identifier for this deployment
    // (previously called strategyId, but now Strategy is created AFTER deployment)
    const { strategyId: deploymentId } = parseResult.data;

    log.info({ deploymentId, msg: 'Starting deployment' });

    // Get RabbitMQ channel
    const connectionManager = getRabbitMQConnection();
    const channel = await connectionManager.getChannel();

    // Start deployment (non-blocking)
    // NOTE: Deployment state must already exist in cache (created by API)
    const deploymentService = getDeploymentService();
    const state = await deploymentService.startDeployment(
      { deploymentId },
      channel
    );

    // Return 202 Accepted with Location header (REST standard)
    return new NextResponse(
      JSON.stringify({
        deploymentId: state.deploymentId,
        status: state.status,
        createdAt: state.startedAt,
      }),
      {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
          'Location': `/api/deployments/${deploymentId}`,
        },
      }
    );
  } catch (error) {
    log.error({ error, msg: 'Deployment error' });

    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
    const code = (error as { code?: string })?.code;

    return NextResponse.json(
      { error: message, code },
      { status: statusCode }
    );
  }
}
