/**
 * GET /api/health - Health check endpoint
 *
 * Returns the health status of the EVM Core API including:
 * - RabbitMQ connection status
 * - Active strategy loops count
 *
 * Response (200):
 * {
 *   status: "healthy" | "unhealthy",
 *   timestamp: string,
 *   rabbitmq: "connected" | "disconnected",
 *   activeLoops: number
 * }
 */

import { NextResponse } from 'next/server';
import { getRabbitMQConnection } from '../../../core/src/mq/connection';
import { getLoopRegistry } from '../../../core/src/registry/loop-registry';

export async function GET() {
  try {
    // Check RabbitMQ connection
    let rabbitmqStatus: 'connected' | 'disconnected' = 'disconnected';
    try {
      const connectionManager = getRabbitMQConnection();
      const channel = await connectionManager.getChannel();
      if (channel) {
        rabbitmqStatus = 'connected';
      }
    } catch {
      rabbitmqStatus = 'disconnected';
    }

    // Get loop count
    const registry = getLoopRegistry();
    const activeLoops = registry.runningCount;

    const isHealthy = rabbitmqStatus === 'connected';

    return NextResponse.json(
      {
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        rabbitmq: rabbitmqStatus,
        activeLoops,
        totalLoops: registry.size,
      },
      { status: isHealthy ? 200 : 503 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
