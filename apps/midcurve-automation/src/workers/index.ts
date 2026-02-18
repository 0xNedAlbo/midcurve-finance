/**
 * Worker Manager
 *
 * Coordinates all automation workers and provides unified lifecycle management.
 * Singleton pattern to ensure only one manager instance exists.
 */

import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { CloseOrderExecutor, type CloseOrderExecutorStatus } from './close-order-executor';
import {
  CloseOrderMonitor,
  type CloseOrderMonitorStatus,
} from './close-order-monitor';
import { RangeMonitor, type RangeMonitorStatus } from './range-monitor';
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
    closeOrderMonitor: CloseOrderMonitorStatus;
    orderExecutor: CloseOrderExecutorStatus;
    outboxPublisher: OutboxPublisherStatus;
    positionClosedOrderCanceller: PositionClosedOrderCancellerStatus;
    rangeMonitor: RangeMonitorStatus;
  };
}

// =============================================================================
// Manager
// =============================================================================

class WorkerManager {
  private status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' = 'idle';
  private startedAt: Date | null = null;

  private closeOrderMonitor: CloseOrderMonitor | null = null;
  private orderExecutor: CloseOrderExecutor | null = null;
  private outboxPublisher: OutboxPublisher | null = null;
  private positionClosedOrderCanceller: PositionClosedOrderCanceller | null = null;
  private rangeMonitor: RangeMonitor | null = null;

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
      const startPromises: Promise<void>[] = [];

      // Start CloseOrderExecutor (executes triggered orders)
      this.orderExecutor = new CloseOrderExecutor();
      startPromises.push(this.orderExecutor.start());

      // Start CloseOrderMonitor (monitors pool prices, triggers close orders)
      this.closeOrderMonitor = new CloseOrderMonitor();
      startPromises.push(this.closeOrderMonitor.start());

      // Start RangeMonitor (monitors all positions for range changes)
      this.rangeMonitor = new RangeMonitor();
      startPromises.push(this.rangeMonitor.start());

      // Start all workers in parallel
      await Promise.all(startPromises);

      // Start domain events workers
      this.outboxPublisher = new OutboxPublisher({ channel });
      this.outboxPublisher.start();

      this.positionClosedOrderCanceller = new PositionClosedOrderCanceller();
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
        this.closeOrderMonitor?.stop(),
        this.orderExecutor?.stop(),
        this.positionClosedOrderCanceller?.stop(),
        this.rangeMonitor?.stop(),
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
        closeOrderMonitor: this.closeOrderMonitor?.getStatus() || {
          status: 'idle',
          orderSubscribers: 0,
          eventsProcessed: 0,
          triggersPublished: 0,
          lastProcessedAt: null,
          lastSyncAt: null,
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
        rangeMonitor: this.rangeMonitor?.getStatus() || {
          status: 'idle',
          poolSubscribers: 0,
          positionsTracked: 0,
          eventsProcessed: 0,
          rangeChangesDetected: 0,
          lastEventAt: null,
          lastSyncAt: null,
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

    const closeOrderMonitorStatus = this.closeOrderMonitor?.getStatus();
    const orderExecutorStatus = this.orderExecutor?.getStatus();
    const outboxPublisherRunning = this.outboxPublisher?.isRunning() ?? false;
    const orderCancellerRunning = this.positionClosedOrderCanceller?.isRunning() ?? false;

    return (
      closeOrderMonitorStatus?.status === 'running' &&
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
export { CloseOrderMonitor, type CloseOrderMonitorStatus };
export { CloseOrderExecutor, type CloseOrderExecutorStatus };
export { RangeMonitor, type RangeMonitorStatus };
