/**
 * RequestScheduler
 *
 * Generic request scheduler that ensures minimum spacing between requests.
 * Uses promise chaining to serialize requests and prevent rate limit violations.
 *
 * Features:
 * - Configurable minimum spacing between requests
 * - Thread-safe promise chaining
 * - Generic - works with any async task
 * - Automatic timing adjustment
 *
 * Use Cases:
 * - Rate-limited APIs (CoinGecko, Twitter, GitHub, etc.)
 * - Resource-constrained operations
 * - Sequential task execution with timing requirements
 *
 * @example
 * ```typescript
 * // CoinGecko: 30 requests/minute = 2000ms spacing
 * const scheduler = new RequestScheduler(2200);
 *
 * // Schedule a request
 * const data = await scheduler.schedule(async () => {
 *   const response = await fetch('https://api.coingecko.com/...');
 *   return response.json();
 * });
 * ```
 */

import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

export interface RequestSchedulerOptions {
  /**
   * Minimum spacing between requests in milliseconds
   * @example 2200 // ~27 requests per minute for CoinGecko
   */
  minSpacingMs: number;

  /**
   * Optional name for logging purposes
   * @default 'RequestScheduler'
   */
  name?: string;
}

/**
 * RequestScheduler
 *
 * Ensures minimum spacing between sequential async tasks.
 * Uses promise chaining to guarantee order and timing.
 */
export class RequestScheduler {
  private chain: Promise<unknown> = Promise.resolve();
  private lastExecutionTime = 0;
  private readonly minSpacingMs: number;
  private readonly name: string;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new RequestScheduler
   *
   * @param options - Configuration options or minimum spacing in milliseconds
   *
   * @example
   * ```typescript
   * // Simple usage
   * const scheduler = new RequestScheduler(2000);
   *
   * // With options
   * const scheduler = new RequestScheduler({
   *   minSpacingMs: 2200,
   *   name: 'CoinGeckoScheduler'
   * });
   * ```
   */
  constructor(options: RequestSchedulerOptions | number) {
    if (typeof options === 'number') {
      this.minSpacingMs = options;
      this.name = 'RequestScheduler';
    } else {
      this.minSpacingMs = options.minSpacingMs;
      this.name = options.name || 'RequestScheduler';
    }

    this.logger = createServiceLogger(this.name);
    this.logger.info(
      { minSpacingMs: this.minSpacingMs },
      'RequestScheduler initialized'
    );
  }

  /**
   * Schedule a task for execution with minimum spacing
   *
   * Tasks are executed sequentially with at least `minSpacingMs` between them.
   * If called multiple times concurrently, tasks are queued and executed in order.
   *
   * @param task - Async function to execute
   * @returns Promise that resolves with the task result
   *
   * @example
   * ```typescript
   * const result = await scheduler.schedule(async () => {
   *   const response = await fetch(url);
   *   return response.json();
   * });
   * ```
   */
  schedule<T>(task: () => Promise<T>): Promise<T> {
    // Create a promise for this specific task
    const taskPromise = new Promise<T>((resolve, reject) => {
      // Chain to maintain order, but don't let errors break the chain
      this.chain = this.chain
        .then(async () => {
          // Calculate wait time based on last execution
          const now = Date.now();
          const timeSinceLastExecution = now - this.lastExecutionTime;
          const waitTime = Math.max(0, this.minSpacingMs - timeSinceLastExecution);

          if (waitTime > 0) {
            this.logger.debug(
              { waitMs: waitTime, timeSinceLastMs: timeSinceLastExecution },
              'Waiting before executing request'
            );
            await this.sleep(waitTime);
          }

          // Execute the task
          try {
            log.methodEntry(this.logger, 'schedule', {
              waitedMs: waitTime,
            });

            const result = await task();

            log.methodExit(this.logger, 'schedule', {
              success: true,
            });

            resolve(result);
          } catch (error) {
            log.methodError(this.logger, 'schedule', error as Error);
            reject(error);
          } finally {
            // Update last execution time
            this.lastExecutionTime = Date.now();
          }
        })
        .catch((error) => {
          // This catch is for errors in the chain setup itself,
          // not task execution errors (those are caught above)
          reject(error);
        });
    });

    return taskPromise;
  }

  /**
   * Get the current queue depth (number of pending tasks)
   *
   * @returns Number of tasks waiting to execute
   */
  getQueueDepth(): number {
    // This is an approximation since we don't track individual promises
    // For detailed monitoring, consider adding a counter
    return 0; // Placeholder - can be enhanced with tracking
  }

  /**
   * Get the time until the next task can execute
   *
   * @returns Milliseconds until next execution, or 0 if ready now
   */
  getTimeUntilNextExecution(): number {
    const now = Date.now();
    const timeSinceLastExecution = now - this.lastExecutionTime;
    return Math.max(0, this.minSpacingMs - timeSinceLastExecution);
  }

  /**
   * Sleep for specified milliseconds
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get scheduler statistics
   *
   * @returns Object with scheduler metrics
   */
  getStats(): {
    minSpacingMs: number;
    lastExecutionTime: number;
    timeUntilNextExecution: number;
  } {
    return {
      minSpacingMs: this.minSpacingMs,
      lastExecutionTime: this.lastExecutionTime,
      timeUntilNextExecution: this.getTimeUntilNextExecution(),
    };
  }
}
