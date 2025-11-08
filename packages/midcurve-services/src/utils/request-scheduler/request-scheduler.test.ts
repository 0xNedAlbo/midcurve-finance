/**
 * Unit tests for RequestScheduler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestScheduler } from './request-scheduler.js';

describe('RequestScheduler', () => {
  let scheduler: RequestScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ============================================================================
  // Constructor and Initialization
  // ============================================================================

  describe('Constructor', () => {
    it('should create scheduler with number parameter', () => {
      scheduler = new RequestScheduler(2000);
      const stats = scheduler.getStats();

      expect(stats.minSpacingMs).toBe(2000);
    });

    it('should create scheduler with options object', () => {
      scheduler = new RequestScheduler({
        minSpacingMs: 3000,
        name: 'TestScheduler',
      });

      const stats = scheduler.getStats();
      expect(stats.minSpacingMs).toBe(3000);
    });

    it('should use default name when not provided', () => {
      scheduler = new RequestScheduler(1000);
      // Name is internal, but scheduler should work
      expect(scheduler).toBeDefined();
    });
  });

  // ============================================================================
  // Request Scheduling
  // ============================================================================

  describe('schedule()', () => {
    beforeEach(() => {
      scheduler = new RequestScheduler(2000);
    });

    it('should execute single task immediately', async () => {
      const task = vi.fn().mockResolvedValue('result');

      const promise = scheduler.schedule(task);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(task).toHaveBeenCalledTimes(1);
      expect(result).toBe('result');
    });

    it('should execute multiple tasks sequentially', async () => {
      const executionOrder: number[] = [];

      const task1 = vi.fn().mockImplementation(async () => {
        executionOrder.push(1);
        return 'result1';
      });

      const task2 = vi.fn().mockImplementation(async () => {
        executionOrder.push(2);
        return 'result2';
      });

      const task3 = vi.fn().mockImplementation(async () => {
        executionOrder.push(3);
        return 'result3';
      });

      const promise1 = scheduler.schedule(task1);
      const promise2 = scheduler.schedule(task2);
      const promise3 = scheduler.schedule(task3);

      await vi.runAllTimersAsync();

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      expect(executionOrder).toEqual([1, 2, 3]);
      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(result3).toBe('result3');
    });

    it('should wait minimum spacing between tasks', async () => {
      scheduler = new RequestScheduler(1000);

      const timestamps: number[] = [];
      const task = vi.fn().mockImplementation(async () => {
        timestamps.push(Date.now());
      });

      // Schedule two tasks
      const promise1 = scheduler.schedule(task);
      const promise2 = scheduler.schedule(task);

      await vi.runAllTimersAsync();
      await Promise.all([promise1, promise2]);

      expect(timestamps).toHaveLength(2);
      const spacing = timestamps[1] - timestamps[0];
      expect(spacing).toBeGreaterThanOrEqual(1000);
    });

    it('should handle task errors without breaking chain', async () => {
      const task1 = vi.fn().mockResolvedValue('success');
      const task2 = vi.fn().mockRejectedValue(new Error('Task failed'));
      const task3 = vi.fn().mockResolvedValue('success after error');

      const promise1 = scheduler.schedule(task1);
      const promise2 = scheduler.schedule(task2);
      const promise3 = scheduler.schedule(task3);

      // Add catch handlers to prevent unhandled rejection warnings
      promise2.catch(() => {});

      await vi.runAllTimersAsync();

      await expect(promise1).resolves.toBe('success');
      await expect(promise2).rejects.toThrow('Task failed');
      await expect(promise3).resolves.toBe('success after error');

      expect(task1).toHaveBeenCalled();
      expect(task2).toHaveBeenCalled();
      expect(task3).toHaveBeenCalled();
    });

    it('should return task result', async () => {
      const task = vi.fn().mockResolvedValue({ data: 'test', count: 42 });

      const promise = scheduler.schedule(task);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ data: 'test', count: 42 });
    });

    it('should propagate task errors', async () => {
      const error = new Error('Task execution failed');
      const task = vi.fn().mockRejectedValue(error);

      const promise = scheduler.schedule(task);
      // Add catch handler to prevent unhandled rejection warning
      promise.catch(() => {});

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Task execution failed');
    });
  });

  // ============================================================================
  // Timing and Spacing
  // ============================================================================

  describe('Timing', () => {
    it('should calculate time until next execution', () => {
      scheduler = new RequestScheduler(2000);

      const stats = scheduler.getStats();
      expect(stats.timeUntilNextExecution).toBe(0); // No previous execution
    });

    it('should update time until next execution after task', async () => {
      scheduler = new RequestScheduler(2000);
      const task = vi.fn().mockResolvedValue('done');

      const promise = scheduler.schedule(task);
      await vi.runAllTimersAsync();
      await promise;

      const timeUntil = scheduler.getTimeUntilNextExecution();
      expect(timeUntil).toBeGreaterThan(0);
      expect(timeUntil).toBeLessThanOrEqual(2000);
    });

    it('should not wait if spacing already exceeded', async () => {
      scheduler = new RequestScheduler(100);
      const task = vi.fn().mockResolvedValue('done');

      // Execute first task
      const promise1 = scheduler.schedule(task);
      await vi.runAllTimersAsync();
      await promise1;

      // Wait longer than spacing
      await vi.advanceTimersByTimeAsync(200);

      // Second task should execute immediately
      const promise2 = scheduler.schedule(task);
      await vi.runAllTimersAsync();
      await promise2;

      expect(task).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // Statistics
  // ============================================================================

  describe('getStats()', () => {
    it('should return correct statistics', () => {
      scheduler = new RequestScheduler(3000);

      const stats = scheduler.getStats();

      expect(stats).toHaveProperty('minSpacingMs');
      expect(stats).toHaveProperty('lastExecutionTime');
      expect(stats).toHaveProperty('timeUntilNextExecution');
      expect(stats.minSpacingMs).toBe(3000);
    });

    it('should update statistics after execution', async () => {
      scheduler = new RequestScheduler(1000);
      const task = vi.fn().mockResolvedValue('done');

      const statsBefore = scheduler.getStats();
      expect(statsBefore.lastExecutionTime).toBe(0);

      const promise = scheduler.schedule(task);
      await vi.runAllTimersAsync();
      await promise;

      const statsAfter = scheduler.getStats();
      expect(statsAfter.lastExecutionTime).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Concurrent Requests
  // ============================================================================

  describe('Concurrent Requests', () => {
    it('should handle many concurrent scheduled tasks', async () => {
      scheduler = new RequestScheduler(100);
      const results: number[] = [];

      const tasks = Array.from({ length: 10 }, (_, i) =>
        scheduler.schedule(async () => {
          results.push(i);
          return i;
        })
      );

      await vi.runAllTimersAsync();
      await Promise.all(tasks);

      // All tasks should complete
      expect(results).toHaveLength(10);
      // Results should be in order
      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should maintain spacing with concurrent requests', async () => {
      scheduler = new RequestScheduler(500);
      const timestamps: number[] = [];

      const tasks = Array.from({ length: 5 }, () =>
        scheduler.schedule(async () => {
          timestamps.push(Date.now());
        })
      );

      await vi.runAllTimersAsync();
      await Promise.all(tasks);

      // Check spacing between consecutive timestamps
      for (let i = 1; i < timestamps.length; i++) {
        const spacing = timestamps[i] - timestamps[i - 1];
        expect(spacing).toBeGreaterThanOrEqual(500);
      }
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle zero spacing', async () => {
      scheduler = new RequestScheduler(0);
      const task = vi.fn().mockResolvedValue('done');

      const promise1 = scheduler.schedule(task);
      const promise2 = scheduler.schedule(task);

      await vi.runAllTimersAsync();
      await Promise.all([promise1, promise2]);

      expect(task).toHaveBeenCalledTimes(2);
    });

    it('should handle very large spacing', () => {
      scheduler = new RequestScheduler(3600000); // 1 hour
      const stats = scheduler.getStats();

      expect(stats.minSpacingMs).toBe(3600000);
    });

    it('should handle task that takes longer than spacing', async () => {
      scheduler = new RequestScheduler(100);
      const longTask = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'done';
      });

      const promise1 = scheduler.schedule(longTask);
      const promise2 = scheduler.schedule(longTask);

      await vi.runAllTimersAsync();
      await Promise.all([promise1, promise2]);

      expect(longTask).toHaveBeenCalledTimes(2);
    });

    it('should handle synchronous errors in tasks', async () => {
      const task = vi.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });

      scheduler = new RequestScheduler(1000);
      const promise = scheduler.schedule(task);
      // Add catch handler to prevent unhandled rejection warning
      promise.catch(() => {});

      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow('Sync error');
    });
  });
});
