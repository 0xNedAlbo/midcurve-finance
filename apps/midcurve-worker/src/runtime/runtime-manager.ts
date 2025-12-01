/**
 * Runtime Manager
 *
 * Manages all active strategy runtimes.
 * - Loads strategies from database
 * - Creates runtime instances
 * - Handles strategy lifecycle (start/stop)
 * - Routes events to correct runtimes
 */

import type { PrismaClient } from '@midcurve/database';
import type { StrategyEvent, StrategyType, SignedStrategyIntentV1 } from '@midcurve/shared';
import type { StrategyImplementation } from '@midcurve/services';
import { BasicUniswapV3StrategyImpl } from '@midcurve/services';
import { createLogger, workerLog } from '../logger.js';
import type { WorkerConfig } from '../config.js';
import { StrategyRuntime } from './strategy-runtime.js';
import type { StrategyRecord } from './strategy-runtime.js';

/**
 * Runtime Manager
 *
 * Central coordinator for all strategy runtimes in the worker.
 */
export class RuntimeManager {
  private readonly logger = createLogger('RuntimeManager');
  private readonly runtimes: Map<string, StrategyRuntime> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly implementations: Map<StrategyType, StrategyImplementation<any, any>>;
  private readonly prisma: PrismaClient;
  private readonly config: WorkerConfig;

  constructor(prisma: PrismaClient, config: WorkerConfig) {
    this.prisma = prisma;
    this.config = config;

    // Register strategy implementations
    this.implementations = new Map();
    this.implementations.set('basicUniswapV3', new BasicUniswapV3StrategyImpl());

    this.logger.info(
      { implementations: Array.from(this.implementations.keys()) },
      'RuntimeManager initialized'
    );
  }

  /**
   * Load and start all active strategies from database
   */
  async loadActiveStrategies(): Promise<void> {
    this.logger.info('Loading active strategies from database');

    const strategies = await this.prisma.strategy.findMany({
      where: { status: 'ACTIVE' },
      include: {
        automationWallet: true,
      },
    });

    this.logger.info({ count: strategies.length }, 'Found active strategies');

    for (const strategy of strategies) {
      try {
        await this.startStrategy(this.toStrategyRecord(strategy));
      } catch (error) {
        this.logger.error(
          { strategyId: strategy.id, error },
          'Failed to start strategy'
        );
      }
    }

    workerLog.startup(this.logger, this.runtimes.size);
  }

  /**
   * Start a strategy runtime
   */
  async startStrategy(record: StrategyRecord): Promise<void> {
    if (this.runtimes.has(record.id)) {
      this.logger.warn({ strategyId: record.id }, 'Strategy already running');
      return;
    }

    const implementation = this.implementations.get(record.strategyType);
    if (!implementation) {
      throw new Error(`No implementation for strategy type: ${record.strategyType}`);
    }

    const runtime = new StrategyRuntime(
      record,
      implementation,
      this.prisma,
      this.config
    );

    this.runtimes.set(record.id, runtime);
    runtime.start();

    this.logger.info(
      { strategyId: record.id, strategyType: record.strategyType },
      'Strategy started'
    );
  }

  /**
   * Stop a strategy runtime
   */
  async stopStrategy(strategyId: string): Promise<void> {
    const runtime = this.runtimes.get(strategyId);
    if (!runtime) {
      this.logger.warn({ strategyId }, 'Strategy not running');
      return;
    }

    await runtime.stop();
    this.runtimes.delete(strategyId);

    this.logger.info({ strategyId }, 'Strategy stopped');
  }

  /**
   * Stop all strategy runtimes
   */
  async stopAll(): Promise<void> {
    this.logger.info({ count: this.runtimes.size }, 'Stopping all strategies');

    const stopPromises = Array.from(this.runtimes.values()).map((runtime) =>
      runtime.stop()
    );
    await Promise.all(stopPromises);

    this.runtimes.clear();
    workerLog.shutdown(this.logger, 'stopAll called');
  }

  /**
   * Route an event to the appropriate strategy runtime
   */
  routeEvent(strategyId: string, event: StrategyEvent): boolean {
    const runtime = this.runtimes.get(strategyId);
    if (!runtime) {
      this.logger.warn(
        { strategyId, eventType: event.eventType },
        'No runtime for strategy, dropping event'
      );
      return false;
    }

    runtime.getMailbox().enqueue(event);
    return true;
  }

  /**
   * Broadcast an event to multiple strategies
   */
  broadcastEvent(strategyIds: string[], event: StrategyEvent): void {
    for (const strategyId of strategyIds) {
      const runtime = this.runtimes.get(strategyId);
      if (runtime) {
        runtime.getMailbox().enqueue({ ...event, strategyId });
      }
    }
  }

  /**
   * Get a specific runtime
   */
  getRuntime(strategyId: string): StrategyRuntime | undefined {
    return this.runtimes.get(strategyId);
  }

  /**
   * Get all active strategy IDs
   */
  getActiveStrategyIds(): string[] {
    return Array.from(this.runtimes.keys());
  }

  /**
   * Get count of active strategies
   */
  getActiveCount(): number {
    return this.runtimes.size;
  }

  /**
   * Check if a strategy is running
   */
  isRunning(strategyId: string): boolean {
    return this.runtimes.has(strategyId);
  }

  /**
   * Get health status
   */
  getHealth(): { healthy: boolean; activeStrategies: number; pendingEvents: number } {
    let pendingEvents = 0;
    for (const runtime of this.runtimes.values()) {
      pendingEvents += runtime.getMailbox().size();
    }

    return {
      healthy: true,
      activeStrategies: this.runtimes.size,
      pendingEvents,
    };
  }

  /**
   * Convert database strategy to StrategyRecord
   *
   * The database stores intent as:
   * - intentSignature: string (Base64 EIP-712 signature)
   * - intentPayload: string (JSON serialized StrategyIntentV1)
   *
   * We need to parse these into the SignedStrategyIntentV1 structure.
   */
  private toStrategyRecord(strategy: {
    id: string;
    userId: string;
    strategyType: string;
    config: unknown;
    state: unknown; // Strategy local state
    status: string;
    intentPayload: string; // JSON serialized intent
    intentSignature: string; // Base64 EIP-712 signature
    automationWallet: {
      id: string;
      walletAddress: string;
    };
  }): StrategyRecord {
    // Parse the intent payload from JSON string
    const intentPayloadParsed = JSON.parse(strategy.intentPayload) as SignedStrategyIntentV1['intent'];

    return {
      id: strategy.id,
      userId: strategy.userId,
      strategyType: strategy.strategyType as StrategyType,
      automationWalletId: strategy.automationWallet.id,
      automationWalletAddress: strategy.automationWallet.walletAddress,
      signedIntent: {
        intent: intentPayloadParsed,
        signature: strategy.intentSignature,
        signer: strategy.automationWallet.walletAddress, // The signer is the automation wallet
      },
      config: strategy.config,
      localState: strategy.state,
      status: strategy.status.toLowerCase() as 'active' | 'paused' | 'closed',
    };
  }
}
