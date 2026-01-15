/**
 * Worker Manager
 *
 * Coordinates all automation workers and provides unified lifecycle management.
 * Singleton pattern to ensure only one manager instance exists.
 */

import { automationLogger, autoLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { getWorkerConfig, type PriceTriggerMode } from '../lib/config';
import { PriceMonitor, type PriceMonitorStatus } from './price-monitor';
import { OrderExecutor, type OrderExecutorStatus } from './order-executor';
import {
  OhlcTriggerConsumer,
  type OhlcTriggerConsumerStatus,
} from './ohlc-trigger-consumer';
import {
  UniswapV3OhlcWorker,
  type UniswapV3OhlcWorkerStatus,
} from './ohlc/uniswapv3/worker';
import { RangeMonitor, type RangeMonitorStatus } from './range-monitor';
import { NotificationWorker, type NotificationWorkerStatus } from './notification-worker';
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
  priceTriggerMode: PriceTriggerMode;
  workers: {
    priceMonitor: PriceMonitorStatus;
    ohlcTriggerConsumer: OhlcTriggerConsumerStatus;
    orderExecutor: OrderExecutorStatus;
    outboxPublisher: OutboxPublisherStatus;
    positionClosedOrderCanceller: PositionClosedOrderCancellerStatus;
    uniswapV3OhlcWorker: UniswapV3OhlcWorkerStatus;
    rangeMonitor: RangeMonitorStatus;
    notificationWorker: NotificationWorkerStatus;
  };
}

// =============================================================================
// Manager
// =============================================================================

class WorkerManager {
  private status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' = 'idle';
  private startedAt: Date | null = null;
  private priceTriggerMode: PriceTriggerMode = 'polling';

  private priceMonitor: PriceMonitor | null = null;
  private ohlcTriggerConsumer: OhlcTriggerConsumer | null = null;
  private orderExecutor: OrderExecutor | null = null;
  private outboxPublisher: OutboxPublisher | null = null;
  private positionClosedOrderCanceller: PositionClosedOrderCanceller | null = null;
  private uniswapV3OhlcWorker: UniswapV3OhlcWorker | null = null;
  private rangeMonitor: RangeMonitor | null = null;
  private notificationWorker: NotificationWorker | null = null;

  /**
   * Start all workers
   *
   * Price trigger mode determines which price monitoring worker is started:
   * - 'polling': Start only PriceMonitor (RPC polling)
   * - 'ohlc': Start only OhlcTriggerConsumer (event-driven)
   * - 'both': Start both (for testing/migration)
   */
  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      log.warn({ msg: 'WorkerManager already running or starting' });
      return;
    }

    this.status = 'starting';
    autoLog.workerLifecycle(log, 'WorkerManager', 'starting');

    try {
      // Get price trigger mode from config
      const workerConfig = getWorkerConfig();
      this.priceTriggerMode = workerConfig.priceTriggerMode;

      log.info({
        priceTriggerMode: this.priceTriggerMode,
        msg: 'Price trigger mode configured',
      });

      // Initialize RabbitMQ connection first
      const mq = getRabbitMQConnection();
      const channel = await mq.connect();

      // Setup domain events topology (exchange, queues, bindings)
      await setupDomainEventsTopology(channel);
      log.info({ msg: 'Domain events topology ready' });

      // Create worker instances based on price trigger mode
      const startPromises: Promise<void>[] = [];

      // Always start OrderExecutor
      this.orderExecutor = new OrderExecutor();
      startPromises.push(this.orderExecutor.start());

      // Always start OHLC worker (produces candles)
      this.uniswapV3OhlcWorker = new UniswapV3OhlcWorker();
      startPromises.push(this.uniswapV3OhlcWorker.start());

      // Conditionally start PriceMonitor based on mode
      if (this.priceTriggerMode === 'polling' || this.priceTriggerMode === 'both') {
        this.priceMonitor = new PriceMonitor();
        startPromises.push(this.priceMonitor.start());
        log.info({ msg: 'PriceMonitor enabled (RPC polling)' });
      }

      // Conditionally start OhlcTriggerConsumer based on mode
      if (this.priceTriggerMode === 'ohlc' || this.priceTriggerMode === 'both') {
        this.ohlcTriggerConsumer = new OhlcTriggerConsumer();
        startPromises.push(this.ohlcTriggerConsumer.start());
        log.info({ msg: 'OhlcTriggerConsumer enabled (event-driven)' });
      }

      // Always start RangeMonitor (monitors all positions for range changes)
      this.rangeMonitor = new RangeMonitor();
      startPromises.push(this.rangeMonitor.start());

      // Always start NotificationWorker (processes notification events)
      this.notificationWorker = new NotificationWorker();
      startPromises.push(this.notificationWorker.start());

      // Start all selected workers in parallel
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
        this.priceMonitor?.stop(),
        this.ohlcTriggerConsumer?.stop(),
        this.orderExecutor?.stop(),
        this.positionClosedOrderCanceller?.stop(),
        this.uniswapV3OhlcWorker?.stop(),
        this.rangeMonitor?.stop(),
        this.notificationWorker?.stop(),
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
      priceTriggerMode: this.priceTriggerMode,
      workers: {
        priceMonitor: this.priceMonitor?.getStatus() || {
          status: 'idle',
          poolsMonitored: 0,
          lastPollAt: null,
          pollIntervalMs: 0,
          triggeredOrdersTotal: 0,
        },
        ohlcTriggerConsumer: this.ohlcTriggerConsumer?.getStatus() || {
          status: 'idle',
          candlesProcessed: 0,
          triggersPublished: 0,
          lastProcessedAt: null,
          lastSyncAt: null,
          poolsSubscribed: 0,
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
        uniswapV3OhlcWorker: this.uniswapV3OhlcWorker?.getStatus() || {
          status: 'idle',
          poolsSubscribed: 0,
          candlesPublished: 0,
          lastPublishAt: null,
        },
        rangeMonitor: this.rangeMonitor?.getStatus() || {
          status: 'idle',
          poolsMonitored: 0,
          positionsChecked: 0,
          lastPollAt: null,
          pollIntervalMs: 0,
          rangeChangesDetected: 0,
        },
        notificationWorker: this.notificationWorker?.getStatus() || {
          status: 'idle',
          consumerCount: 0,
          processedTotal: 0,
          failedTotal: 0,
          webhooksSentTotal: 0,
          lastProcessedAt: null,
        },
      },
    };
  }

  /**
   * Check if workers are healthy
   *
   * Health checks are mode-aware:
   * - In 'polling' mode: Only PriceMonitor is checked
   * - In 'ohlc' mode: Only OhlcTriggerConsumer is checked
   * - In 'both' mode: Both are checked
   */
  isHealthy(): boolean {
    if (this.status !== 'running') {
      return false;
    }

    const orderExecutorStatus = this.orderExecutor?.getStatus();
    const outboxPublisherRunning = this.outboxPublisher?.isRunning() ?? false;
    const orderCancellerRunning = this.positionClosedOrderCanceller?.isRunning() ?? false;
    const ohlcWorkerStatus = this.uniswapV3OhlcWorker?.getStatus();

    // Base health checks (always required)
    const baseHealthy =
      orderExecutorStatus?.status === 'running' &&
      outboxPublisherRunning &&
      orderCancellerRunning &&
      (ohlcWorkerStatus?.status === 'running' || ohlcWorkerStatus?.status === 'idle');

    if (!baseHealthy) {
      return false;
    }

    // Mode-specific health checks for price trigger workers
    const priceMonitorStatus = this.priceMonitor?.getStatus();
    const ohlcTriggerStatus = this.ohlcTriggerConsumer?.getStatus();

    switch (this.priceTriggerMode) {
      case 'polling':
        return priceMonitorStatus?.status === 'running';
      case 'ohlc':
        return ohlcTriggerStatus?.status === 'running';
      case 'both':
        return (
          priceMonitorStatus?.status === 'running' &&
          ohlcTriggerStatus?.status === 'running'
        );
      default:
        return false;
    }
  }

  /**
   * Get the Uniswap V3 OHLC worker instance
   * Used by API routes to manage subscriptions
   */
  getUniswapV3OhlcWorker(): UniswapV3OhlcWorker | null {
    return this.uniswapV3OhlcWorker;
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
export { OhlcTriggerConsumer, type OhlcTriggerConsumerStatus };
export { OrderExecutor, type OrderExecutorStatus };
export { UniswapV3OhlcWorker, type UniswapV3OhlcWorkerStatus };
export { RangeMonitor, type RangeMonitorStatus };
export { NotificationWorker, type NotificationWorkerStatus };
