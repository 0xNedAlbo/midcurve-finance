/**
 * Health Check Endpoint
 *
 * Returns service health status including worker states, the executor's failure
 * count, and the depth of every dead-letter queue in the system.
 */

import { NextResponse } from 'next/server';
import type { QueueDepth } from '@midcurve/services';
import { getWorkerManager } from '../../../workers';
import { getRabbitMQConnection } from '../../../mq/connection-manager';
import { probeDeadLetterQueues } from '../../../mq/queue-depth';
import { automationLogger } from '../../../lib/logger';

const log = automationLogger.child({ component: 'HealthRoute' });

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  service: string;
  version: string;
  checks: {
    workers: {
      status: 'ok' | 'degraded' | 'error';
      message?: string;
      /**
       * Triggered orders the executor failed to process since it started.
       * /api/workers/status has carried this all along; it was the one number
       * this endpoint computed, aggregated and then dropped at the wire.
       */
      failedTotal: number;
    };
    rabbitmq: {
      status: 'ok' | 'error';
      message?: string;
    };
    /**
     * Depth of each dead-letter queue. `messages: null` means the queue does
     * not exist — normal on a broker where a service has not started yet.
     *
     * Empty means no depths were obtained: RabbitMQ is not connected, the probe
     * exceeded its budget, or it failed. One meaning, three causes — the field
     * says what was learned, not why.
     */
    deadLetterQueues: QueueDepth[];
  };
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const timestamp = new Date().toISOString();
  const service = 'midcurve-automation';
  const version = process.env.npm_package_version || '0.1.0';

  // Check workers
  const workerManager = getWorkerManager();
  const workerStatus = workerManager.getStatus();
  const workersHealthy = workerManager.isHealthy();

  // Check RabbitMQ
  const mq = getRabbitMQConnection();
  const mqConnected = mq.isConnected();

  // The probe is bounded and its failure is contained here. A health endpoint
  // that hangs, or that 500s without a body, is a worse signal than one that
  // reports fewer numbers: to a liveness probe both read as a dead service, and
  // the restart they trigger cannot fix a broker that is slow or gone. That is
  // decision 4's reasoning applied to the probe rather than to its subject.
  //
  // Before this endpoint reported depths at all, the same conditions returned
  // 503 with `rabbitmq: error` in the body. It still does — `status` stays
  // governed by mqConnected, and no third state enters the contract.
  //
  // This is the message-handler boundary under .claude/rules/error-handling.md,
  // and the catch is not a swallow: it logs, and the empty array is not passed
  // off as "all three queues are empty".
  let deadLetterQueues: QueueDepth[] = [];

  if (mqConnected) {
    try {
      deadLetterQueues = await probeDeadLetterQueues();
    } catch (err) {
      log.warn({
        error: err instanceof Error ? err.message : String(err),
        msg: 'Dead-letter depth probe failed; reporting no depths rather than failing the endpoint',
      });
    }
  }

  // Determine overall health.
  //
  // Dead letters deliberately do not enter this. A message in a DLQ is a thing
  // for a human to look at; failing the health probe on it would invite a
  // restart loop on a condition that restarting cannot fix. Same for a queue
  // that does not exist — telling "absent" from "not started yet" needs a notion
  // of expected topology that nothing here has.
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (!mqConnected) {
    overallStatus = 'unhealthy';
  } else if (!workersHealthy) {
    overallStatus = workerStatus.status === 'idle' ? 'healthy' : 'degraded';
  }

  const response: HealthResponse = {
    status: overallStatus,
    timestamp,
    service,
    version,
    checks: {
      workers: {
        status: workersHealthy ? 'ok' : workerStatus.status === 'idle' ? 'ok' : 'degraded',
        message: workerStatus.status === 'idle' ? 'Workers not started' : undefined,
        failedTotal: workerStatus.workers.orderExecutor.failedTotal,
      },
      rabbitmq: {
        status: mqConnected ? 'ok' : 'error',
        message: mqConnected ? undefined : 'RabbitMQ not connected',
      },
      deadLetterQueues,
    },
  };

  const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;

  return NextResponse.json(response, { status: httpStatus });
}
