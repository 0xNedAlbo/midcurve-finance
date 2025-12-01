/**
 * Action Poller
 *
 * Polls the database for new user actions and converts them to strategy events.
 * Actions are submitted via the API and picked up by the worker.
 */

import type { PrismaClient } from '@midcurve/database';
import type { ActionStrategyEvent, StrategyActionType } from '@midcurve/shared';
import { createLogger } from '../logger.js';
import type { RuntimeManager } from '../runtime/index.js';

const logger = createLogger('ActionPoller');

/**
 * Action Poller
 *
 * Periodically checks for pending actions and routes them to strategy runtimes.
 */
export class ActionPoller {
  private readonly prisma: PrismaClient;
  private readonly runtimeManager: RuntimeManager;
  private readonly pollIntervalMs: number;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    prisma: PrismaClient,
    runtimeManager: RuntimeManager,
    pollIntervalMs: number = 5000
  ) {
    this.prisma = prisma;
    this.runtimeManager = runtimeManager;
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Start polling for actions
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    logger.info({ pollIntervalMs: this.pollIntervalMs }, 'Starting action poller');

    // Run immediately, then on interval
    this.poll().catch((error) => {
      logger.error({ error }, 'Initial poll failed');
    });

    this.pollTimer = setInterval(() => {
      this.poll().catch((error) => {
        logger.error({ error }, 'Poll cycle failed');
      });
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    logger.info('Action poller stopped');
  }

  /**
   * Poll for pending actions
   */
  private async poll(): Promise<void> {
    // Get active strategy IDs
    const activeStrategyIds = this.runtimeManager.getActiveStrategyIds();
    if (activeStrategyIds.length === 0) {
      return; // No active strategies
    }

    // Find pending actions for active strategies
    // Note: status values in schema are lowercase ('pending', 'accepted', etc.)
    const pendingActions = await this.prisma.strategyAction.findMany({
      where: {
        strategyId: { in: activeStrategyIds },
        status: 'pending',
      },
      orderBy: { createdAt: 'asc' },
      take: 100, // Process in batches
    });

    if (pendingActions.length === 0) {
      return; // No pending actions
    }

    logger.debug({ count: pendingActions.length }, 'Found pending actions');

    // Process each action
    for (const action of pendingActions) {
      try {
        // Mark as accepted
        await this.prisma.strategyAction.update({
          where: { id: action.id },
          data: {
            status: 'accepted',
            processedAt: new Date(),
            updatedAt: new Date(),
          },
        });

        // Convert to strategy event
        const event: ActionStrategyEvent = {
          eventType: 'action',
          strategyId: action.strategyId,
          ts: Date.now(),
          actionId: action.id,
          actionType: action.actionType.toLowerCase() as StrategyActionType,
          payload: action.payload,
        };

        // Route to runtime
        const routed = this.runtimeManager.routeEvent(action.strategyId, event);

        if (!routed) {
          // Strategy not running, mark as rejected
          await this.prisma.strategyAction.update({
            where: { id: action.id },
            data: {
              status: 'rejected',
              errorMessage: 'Strategy not running',
              completedAt: new Date(),
              updatedAt: new Date(),
            },
          });

          logger.warn(
            { actionId: action.id, strategyId: action.strategyId },
            'Action rejected - strategy not running'
          );
        } else {
          logger.info(
            {
              actionId: action.id,
              strategyId: action.strategyId,
              actionType: action.actionType,
            },
            'Action accepted and routed'
          );
        }
      } catch (error) {
        logger.error(
          { actionId: action.id, error },
          'Failed to process action'
        );

        // Mark as errored
        await this.prisma.strategyAction.update({
          where: { id: action.id },
          data: {
            status: 'errored',
            errorMessage: error instanceof Error ? error.message : String(error),
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    }
  }
}
