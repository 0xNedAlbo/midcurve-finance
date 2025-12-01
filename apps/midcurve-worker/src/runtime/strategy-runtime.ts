/**
 * Strategy Runtime
 *
 * Per-strategy execution context that:
 * - Maintains the strategy's mailbox (event queue)
 * - Processes events sequentially
 * - Provides the StrategyRuntimeApi to strategy implementations
 * - Manages local state persistence
 */

import type { PrismaClient } from '@midcurve/database';
import type {
  StrategyEvent,
  StrategyType,
  SignedStrategyIntentV1,
} from '@midcurve/shared';
import type {
  StrategyImplementation,
  StrategyRuntimeApi,
} from '@midcurve/services';
import {
  StrategyMailbox,
  SignerClient,
} from '@midcurve/services';
import type pino from 'pino';
import { createLogger, workerLog } from '../logger.js';
import type { WorkerConfig } from '../config.js';

/**
 * Strategy record from database
 */
export interface StrategyRecord {
  id: string;
  userId: string;
  strategyType: StrategyType;
  automationWalletId: string;
  automationWalletAddress: string;
  signedIntent: SignedStrategyIntentV1;
  config: unknown;
  localState: unknown;
  status: 'active' | 'paused' | 'closed';
}

/**
 * Runtime state for a single strategy
 */
export interface StrategyRuntimeState {
  strategyId: string;
  strategyType: StrategyType;
  userId: string;
  config: unknown;
  localState: unknown;
  signedIntent: SignedStrategyIntentV1;
  automationWalletAddress: string;
  processing: boolean;
}

/**
 * Extended runtime API with signer support
 */
export interface WorkerRuntimeApi extends StrategyRuntimeApi {
  /** Get the signer client for transaction signing */
  getSignerClient(): SignerClient;
  /** Get the signed strategy intent for authorization */
  getSignedIntent(): SignedStrategyIntentV1;
  /** Get the automation wallet address */
  getWalletAddress(): string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStrategyImplementation = StrategyImplementation<any, any>;

/**
 * Strategy Runtime manages execution for a single strategy
 */
export class StrategyRuntime {
  private readonly logger: pino.Logger;
  private readonly state: StrategyRuntimeState;
  private readonly mailbox: StrategyMailbox;
  private readonly implementation: AnyStrategyImplementation;
  private readonly prisma: PrismaClient;
  private readonly signerClient: SignerClient;
  private readonly api: WorkerRuntimeApi;

  private running = false;
  private processPromise: Promise<void> | null = null;

  constructor(
    record: StrategyRecord,
    implementation: AnyStrategyImplementation,
    prisma: PrismaClient,
    config: WorkerConfig
  ) {
    this.logger = createLogger(`runtime:${record.id}`);
    this.mailbox = new StrategyMailbox(record.id);
    this.implementation = implementation;
    this.prisma = prisma;

    // Initialize signer client
    this.signerClient = new SignerClient({
      baseUrl: config.signer.url,
      apiKey: config.signer.apiKey,
    });

    // Initialize state from record
    this.state = {
      strategyId: record.id,
      strategyType: record.strategyType,
      userId: record.userId,
      config: record.config,
      localState: record.localState ?? {},
      signedIntent: record.signedIntent,
      automationWalletAddress: record.automationWalletAddress,
      processing: false,
    };

    // Create the runtime API that strategies use
    this.api = this.createRuntimeApi();

    workerLog.strategyLoaded(this.logger, record.id, record.strategyType);
  }

  /**
   * Start processing events for this strategy
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.processPromise = this.processLoop();
    this.logger.info({ strategyId: this.state.strategyId }, 'Strategy runtime started');
  }

  /**
   * Stop processing (gracefully waits for current event to complete)
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.processPromise) {
      await this.processPromise;
    }
    workerLog.strategyUnloaded(this.logger, this.state.strategyId);
  }

  /**
   * Get the strategy ID
   */
  get strategyId(): string {
    return this.state.strategyId;
  }

  /**
   * Get the mailbox for enqueueing events
   */
  getMailbox(): StrategyMailbox {
    return this.mailbox;
  }

  /**
   * Check if the runtime is processing
   */
  isProcessing(): boolean {
    return this.state.processing;
  }

  /**
   * Check if the runtime is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get current state (for debugging/monitoring)
   */
  getState(): Readonly<StrategyRuntimeState> {
    return { ...this.state };
  }

  /**
   * Main processing loop - takes events from mailbox and processes them
   */
  private async processLoop(): Promise<void> {
    while (this.running) {
      // Check for events
      const event = this.mailbox.dequeue();

      if (!event) {
        // No event, sleep briefly and check again
        await this.sleep(100);
        continue;
      }

      await this.processEvent(event);
    }
  }

  /**
   * Sleep for a duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Process a single event
   */
  private async processEvent(event: StrategyEvent): Promise<void> {
    const startTime = Date.now();
    this.state.processing = true;

    workerLog.eventReceived(
      this.logger,
      this.state.strategyId,
      event.eventType,
      'id' in event ? (event as { id?: string }).id : undefined
    );

    try {
      // Build external state (market data, position data, etc.)
      const externalState = await this.buildExternalState();

      // Run the strategy implementation
      const newLocalState = await this.implementation.run({
        strategyId: this.state.strategyId,
        strategyType: this.state.strategyType,
        userId: this.state.userId,
        config: this.state.config,
        localState: this.state.localState,
        externalState,
        event,
        api: this.api,
      });

      // Update local state
      this.state.localState = newLocalState;

      // Persist state to database
      await this.persistState();

      const durationMs = Date.now() - startTime;
      workerLog.eventProcessed(
        this.logger,
        this.state.strategyId,
        event.eventType,
        durationMs,
        true
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      workerLog.eventProcessed(
        this.logger,
        this.state.strategyId,
        event.eventType,
        durationMs,
        false,
        errorMessage
      );

      // Log full error for debugging
      this.logger.error({ error, event }, 'Event processing error');

      // TODO: Decide on error handling policy
      // - Should we retry?
      // - Should we pause the strategy?
      // - Should we notify the user?
    } finally {
      this.state.processing = false;
    }
  }

  /**
   * Build external state for strategy execution
   * TODO: This will be expanded with real market data, position data, etc.
   */
  private async buildExternalState(): Promise<unknown> {
    // For now, return minimal external state
    // This will be expanded with:
    // - Current pool prices
    // - Position snapshots
    // - Market data (OHLC, funding rates)
    return {
      timestamp: Date.now(),
    };
  }

  /**
   * Persist local state to database
   */
  private async persistState(): Promise<void> {
    await this.prisma.strategy.update({
      where: { id: this.state.strategyId },
      data: {
        state: this.state.localState as object,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Create the StrategyRuntimeApi that strategies use to interact with the runtime
   */
  private createRuntimeApi(): WorkerRuntimeApi {
    const pendingEffects = new Map<string, { effectType: string; timeoutAt?: number }>();
    let effectCounter = 0;

    return {
      /**
       * Start an effect (e.g., swap, liquidity change, hedge adjustment)
       */
      startEffect: (input: { effectType: string; payload: unknown; timeoutMs?: number }): string => {
        const effectId = `${this.state.strategyId}-effect-${++effectCounter}-${Date.now()}`;

        pendingEffects.set(effectId, {
          effectType: input.effectType,
          timeoutAt: input.timeoutMs ? Date.now() + input.timeoutMs : undefined,
        });

        workerLog.effectStarted(
          this.logger,
          this.state.strategyId,
          effectId,
          input.effectType
        );

        // TODO: Queue the effect for execution
        // This will be handled by the EffectExecutor
        this.logger.info({
          effectId,
          effectType: input.effectType,
          payload: input.payload,
          msg: 'Effect queued for execution',
        });

        return effectId;
      },

      /**
       * Subscribe to OHLC data for a symbol
       * TODO: Implement market data subscriptions
       */
      subscribeOhlc: (input: { symbol: string; timeframe: '1m' }): void => {
        this.logger.debug({
          symbol: input.symbol,
          timeframe: input.timeframe,
          msg: 'OHLC subscription requested',
        });
        // TODO: Register subscription with market data provider
      },

      /**
       * Unsubscribe from OHLC data
       */
      unsubscribeOhlc: (input: { symbol: string; timeframe: '1m' }): void => {
        this.logger.debug({
          symbol: input.symbol,
          timeframe: input.timeframe,
          msg: 'OHLC unsubscription requested',
        });
        // TODO: Remove subscription from market data provider
      },

      /**
       * Get current timestamp
       */
      now: (): number => {
        return Date.now();
      },

      /**
       * Log a message
       */
      log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void => {
        this.logger[level]({ strategyLog: true, data }, message);
      },

      /**
       * Get the signer client for transaction signing
       */
      getSignerClient: (): SignerClient => {
        return this.signerClient;
      },

      /**
       * Get the signed strategy intent for authorization
       */
      getSignedIntent: (): SignedStrategyIntentV1 => {
        return this.state.signedIntent;
      },

      /**
       * Get the automation wallet address
       */
      getWalletAddress: (): string => {
        return this.state.automationWalletAddress;
      },
    };
  }
}
