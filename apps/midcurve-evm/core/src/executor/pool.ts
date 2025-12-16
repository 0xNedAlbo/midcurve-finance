/**
 * Executor Pool Manager
 *
 * Manages a pool of executor instances for parallel
 * effect processing from the effects.pending queue.
 */

import type { Channel } from 'amqplib';
import { Executor, type ExecutorStats } from './executor.js';

// ============================================================
// Types
// ============================================================

export interface ExecutorPoolConfig {
  /** RabbitMQ channel */
  channel: Channel;
  /** Number of executor instances */
  poolSize: number;
  /** Base executor ID prefix (default: 'executor') */
  executorIdPrefix?: string;
  /** Prefetch per executor (default: 1) */
  prefetch?: number;
}

export interface ExecutorPoolStats {
  /** Total effects processed across all executors */
  totalProcessed: number;
  /** Total effects failed across all executors */
  totalFailed: number;
  /** Number of executors in the pool */
  executorCount: number;
  /** Per-executor statistics */
  executors: Array<{ id: string; stats: ExecutorStats }>;
}

// ============================================================
// ExecutorPool Class
// ============================================================

/**
 * Pool of executor instances.
 *
 * The pool manages N executor instances that all consume from
 * the same effects.pending queue as competing consumers.
 * Each executor has prefetch=1 for fair work distribution.
 */
export class ExecutorPool {
  private executors: Array<{ id: string; executor: Executor }> = [];
  private config: Required<ExecutorPoolConfig>;

  constructor(config: ExecutorPoolConfig) {
    this.config = {
      ...config,
      executorIdPrefix: config.executorIdPrefix ?? 'executor',
      prefetch: config.prefetch ?? 1,
    };
  }

  /**
   * Start all executors in the pool.
   */
  async start(): Promise<void> {
    console.log(
      `[ExecutorPool] Starting ${this.config.poolSize} executors...`
    );

    for (let i = 0; i < this.config.poolSize; i++) {
      const executorId = `${this.config.executorIdPrefix}-${i + 1}`;
      const executor = new Executor({
        channel: this.config.channel,
        executorId,
        prefetch: this.config.prefetch,
      });

      await executor.start();
      this.executors.push({ id: executorId, executor });
    }

    console.log(
      `[ExecutorPool] All ${this.config.poolSize} executors started`
    );
  }

  /**
   * Stop all executors gracefully.
   */
  async stop(): Promise<void> {
    console.log(
      `[ExecutorPool] Stopping ${this.executors.length} executors...`
    );

    await Promise.all(this.executors.map(({ executor }) => executor.stop()));
    this.executors = [];

    console.log('[ExecutorPool] All executors stopped');
  }

  /**
   * Get aggregated statistics from all executors.
   */
  getStats(): ExecutorPoolStats {
    const executorStats = this.executors.map(({ id, executor }) => ({
      id,
      stats: executor.getStats(),
    }));

    return {
      totalProcessed: executorStats.reduce(
        (sum, { stats }) => sum + stats.processed,
        0
      ),
      totalFailed: executorStats.reduce(
        (sum, { stats }) => sum + stats.failed,
        0
      ),
      executorCount: this.executors.length,
      executors: executorStats,
    };
  }

  /**
   * Get the number of executors in the pool.
   */
  get size(): number {
    return this.executors.length;
  }

  /**
   * Check if the pool is running.
   */
  get running(): boolean {
    return this.executors.length > 0 && this.executors[0].executor.getStats().running;
  }
}
