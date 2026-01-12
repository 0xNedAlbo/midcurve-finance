/**
 * Worker Manager
 *
 * Coordinates all automation workers and provides unified lifecycle management.
 * Singleton pattern to ensure only one manager instance exists.
 */

import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { PriceMonitor, type PriceMonitorStatus } from './price-monitor';
import { OrderExecutor, type OrderExecutorStatus } from './order-executor';
import {
  OutboxPublisher,
  PositionClosedOrderCanceller,
  setupDomainEventsTopology,
} from '@midcurve/services';

const log = automationLogger.child({ component: 'WorkerManager' });

// =============================================================================
// Types
// =============================================================================

export interface OutboxPublisherStatus {
  running: boolean;
}

export interface PositionClosedOrderCancellerStatus {
  running: boolean;
}

export interface WorkerManagerStatus {
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';
  startedAt: string | null;
  workers: {
    priceMonitor: PriceMonitorStatus;
    orderExecutor: OrderExecutorStatus;
    outboxPublisher: OutboxPublisherStatus;
    positionClosedOrderCanceller: PositionClosedOrderCancellerStatus;
  };
}

// =============================================================================
// Manager
// =============================================================================

class WorkerManager {
  private status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' = 'idle';
  private startedAt: Date | null = null;

  private priceMonitor: PriceMonitor | null = null;
  private orderExecutor: OrderExecutor | null = null;
  private outboxPublisher: OutboxPublisher | null = null;
  private positionClosedOrderCanceller: PositionClosedOrderCanceller | null = null;

  /**
   * Start all workers
   */
  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      log.warn({ msg: 'WorkerManager already running or starting' });
      return;
    }

    this.status = 'starting';
    autoLog.workerLifecycle(log, 'WorkerManager', 'starting');

    try {
      // Initialize RabbitMQ connection first
      const mq = getRabbitMQConnection();
      const channel = await mq.connect();

      // Setup domain events topology (exchange, queues, bindings)
      await setupDomainEventsTopology(channel);
      log.info({ msg: 'Domain events topology ready' });

      // Create worker instances
      this.priceMonitor = new PriceMonitor();
      this.orderExecutor = new OrderExecutor();
      this.outboxPublisher = new OutboxPublisher({ channel });
      this.positionClosedOrderCanceller = new PositionClosedOrderCanceller();

      // Start all workers in parallel
      await Promise.all([
        this.priceMonitor.start(),
        this.orderExecutor.start(),
      ]);

      // Start domain events workers
      this.outboxPublisher.start();
      await this.positionClosedOrderCanceller.start(channel);

      this.status = 'running';
      this.startedAt = new Date();

      autoLog.workerLifecycle(log, 'WorkerManager', 'started');

      log.info({ msg: 'All workers started successfully' });
    } catch (err) {
      this.status = 'stopped';
      autoLog.methodError(log, 'start', err);
      throw err;
    }
  }

  /**
   * Stop all workers
   */
  async stop(): Promise<void> {
    if (this.status !== 'running') {
      return;
    }

    this.status = 'stopping';
    autoLog.workerLifecycle(log, 'WorkerManager', 'stopping');

    try {
      // Stop all workers in parallel
      await Promise.all([
        this.priceMonitor?.stop(),
        this.orderExecutor?.stop(),
        this.positionClosedOrderCanceller?.stop(),
      ]);

      // Stop outbox publisher (synchronous)
      this.outboxPublisher?.stop();

      // Close RabbitMQ connection
      const mq = getRabbitMQConnection();
      await mq.close();

      this.status = 'stopped';
      autoLog.workerLifecycle(log, 'WorkerManager', 'stopped');

      log.info({ msg: 'All workers stopped successfully' });
    } catch (err) {
      autoLog.methodError(log, 'stop', err);
      throw err;
    }
  }

  /**
   * Get combined status of all workers
   */
  getStatus(): WorkerManagerStatus {
    return {
      status: this.status,
      startedAt: this.startedAt?.toISOString() || null,
      workers: {
        priceMonitor: this.priceMonitor?.getStatus() || {
          status: 'idle',
          poolsMonitored: 0,
          lastPollAt: null,
          pollIntervalMs: 0,
          triggeredOrdersTotal: 0,
        },
        orderExecutor: this.orderExecutor?.getStatus() || {
          status: 'idle',
          consumerCount: 0,
          processedTotal: 0,
          failedTotal: 0,
          lastProcessedAt: null,
        },
        outboxPublisher: {
          running: this.outboxPublisher?.isRunning() ?? false,
        },
        positionClosedOrderCanceller: {
          running: this.positionClosedOrderCanceller?.isRunning() ?? false,
        },
      },
    };
  }

  /**
   * Check if workers are healthy
   */
  isHealthy(): boolean {
    if (this.status !== 'running') {
      return false;
    }

    const priceMonitorStatus = this.priceMonitor?.getStatus();
    const orderExecutorStatus = this.orderExecutor?.getStatus();
    const outboxPublisherRunning = this.outboxPublisher?.isRunning() ?? false;
    const orderCancellerRunning = this.positionClosedOrderCanceller?.isRunning() ?? false;

    return (
      priceMonitorStatus?.status === 'running' &&
      orderExecutorStatus?.status === 'running' &&
      outboxPublisherRunning &&
      orderCancellerRunning
    );
  }
}

// =============================================================================
// Singleton
// =============================================================================

// Use globalThis to survive Next.js HMR
const globalForWorkerManager = globalThis as unknown as {
  automationWorkerManager: WorkerManager | undefined;
};

export function getWorkerManager(): WorkerManager {
  if (!globalForWorkerManager.automationWorkerManager) {
    globalForWorkerManager.automationWorkerManager = new WorkerManager();
  }
  return globalForWorkerManager.automationWorkerManager;
}

/**
 * Start all automation workers
 * Convenience function for scripts
 */
export async function startWorkers(): Promise<WorkerManager> {
  const manager = getWorkerManager();
  await manager.start();
  return manager;
}

/**
 * Stop all automation workers
 * Convenience function for scripts
 */
export async function stopWorkers(): Promise<void> {
  const manager = getWorkerManager();
  await manager.stop();
}

// Re-export types
export { PriceMonitor, type PriceMonitorStatus };
export { OrderExecutor, type OrderExecutorStatus };
