/**
 * Health Check Endpoint
 *
 * Returns service health status including worker states.
 */

import { NextResponse } from 'next/server';
import { getWorkerManager } from '../../../workers';
import { getRabbitMQConnection } from '../../../mq/connection-manager';

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  service: string;
  version: string;
  checks: {
    workers: {
      status: 'ok' | 'degraded' | 'error';
      message?: string;
    };
    rabbitmq: {
      status: 'ok' | 'error';
      message?: string;
    };
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

  // Determine overall health
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
      },
      rabbitmq: {
        status: mqConnected ? 'ok' : 'error',
        message: mqConnected ? undefined : 'RabbitMQ not connected',
      },
    },
  };

  const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;

  return NextResponse.json(response, { status: httpStatus });
}
