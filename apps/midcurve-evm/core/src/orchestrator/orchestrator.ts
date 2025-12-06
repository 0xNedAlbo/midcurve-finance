import type { Address, Hex, Log } from 'viem';
import { encodeFunctionData } from 'viem';
import type pino from 'pino';
import { createLogger, getLogMethod } from '../utils/logger.js';
import { GAS_LIMITS } from '../utils/addresses.js';
import { VmRunner } from '../vm/vm-runner.js';
import { EventDecoder, SUBSCRIPTION_TYPES } from '../events/index.js';
import {
  SubscriptionManager,
  MemorySubscriptionStore,
} from '../subscriptions/index.js';
import { StoreSynchronizer } from '../stores/index.js';
import type { ExternalEvent } from '../stores/types.js';
import { EffectEngine, MockEffectExecutor } from '../effects/index.js';
import type { EffectResult } from '../effects/types.js';
import { MailboxManager } from './mailbox-manager.js';
import type {
  MailboxEvent,
  OrchestratorConfig,
  MailboxStats,
} from './types.js';

/**
 * ABI for OHLC consumer callback
 */
const OHLC_CALLBACK_ABI = [
  {
    type: 'function',
    name: 'onOhlcCandle',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'timeframe', type: 'uint8' },
      {
        name: 'candle',
        type: 'tuple',
        components: [
          { name: 'timestamp', type: 'uint256' },
          { name: 'open', type: 'uint256' },
          { name: 'high', type: 'uint256' },
          { name: 'low', type: 'uint256' },
          { name: 'close', type: 'uint256' },
          { name: 'volume', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * ABI for effect result callbacks
 */
const EFFECT_CALLBACK_ABI = [
  {
    type: 'function',
    name: 'onAddLiquidityComplete',
    inputs: [
      { name: 'effectId', type: 'bytes32' },
      { name: 'success', type: 'bool' },
      { name: 'resultData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'onRemoveLiquidityComplete',
    inputs: [
      { name: 'effectId', type: 'bytes32' },
      { name: 'success', type: 'bool' },
      { name: 'resultData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'onCollectFeesComplete',
    inputs: [
      { name: 'effectId', type: 'bytes32' },
      { name: 'success', type: 'bool' },
      { name: 'resultData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'onWithdrawComplete',
    inputs: [
      { name: 'effectId', type: 'bytes32' },
      { name: 'success', type: 'bool' },
      { name: 'resultData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * CoreOrchestrator is the central coordinator for the SEMSEE system.
 *
 * Responsibilities:
 * - Receive external events (OHLC, pool, position, balance updates)
 * - Update stores with external data
 * - Route events to subscribed strategies
 * - Process strategy-emitted events (subscriptions, actions, logs)
 * - Deliver effect results back to strategies
 *
 * Concurrency Model:
 * - Uses per-strategy mailboxes for parallel processing across strategies
 * - Maintains ordered processing within each strategy
 * - Processes logs IN ORDER (not grouped by type)
 */
export class CoreOrchestrator {
  private logger: pino.Logger;
  private vmRunner: VmRunner;
  private eventDecoder: EventDecoder;
  private subscriptionManager: SubscriptionManager;
  private storeSynchronizer: StoreSynchronizer;
  private effectEngine: EffectEngine;
  private mailboxManager: MailboxManager;
  private callbackGasLimit: bigint;

  private isInitialized = false;
  private isShuttingDown = false;

  constructor(config: OrchestratorConfig = {}) {
    this.logger = createLogger('orchestrator');
    this.callbackGasLimit = config.callbackGasLimit ?? GAS_LIMITS.CALLBACK;

    // Initialize VM runner
    this.vmRunner = new VmRunner({
      rpcUrl: config.rpcUrl,
      wsUrl: config.wsUrl,
    });

    // Initialize event decoder
    this.eventDecoder = new EventDecoder();

    // Initialize subscription manager with in-memory store
    const subscriptionStore = new MemorySubscriptionStore();
    this.subscriptionManager = new SubscriptionManager(
      subscriptionStore,
      this.logger.child({ component: 'subscriptions' })
    );

    // Initialize store synchronizer
    this.storeSynchronizer = new StoreSynchronizer(
      this.vmRunner,
      this.logger.child({ component: 'stores' })
    );

    // Initialize effect engine with mock executor
    const mockExecutor = new MockEffectExecutor();
    this.effectEngine = new EffectEngine(
      mockExecutor,
      this.logger.child({ component: 'effects' })
    );

    // Initialize mailbox manager
    this.mailboxManager = new MailboxManager((strategy, event) =>
      this.processMailboxEvent(strategy, event)
    );

    // Wire up callbacks
    this.effectEngine.setOnEffectComplete((strategy, result) =>
      this.deliverEffectResult(strategy, result)
    );
  }

  /**
   * Initialize the orchestrator.
   * Must be called before processing events.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.logger.info('Initializing orchestrator...');

    // Initialize VM connection
    await this.vmRunner.initialize();

    // Initialize store synchronizer (gets store addresses)
    await this.storeSynchronizer.initialize();

    this.isInitialized = true;
    this.logger.info('Orchestrator initialized');
  }

  /**
   * Publish an external event to the system.
   * Called by data sources when new data arrives.
   *
   * @param event The external event to publish
   */
  async publishEvent(event: ExternalEvent): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Orchestrator not initialized');
    }

    if (this.isShuttingDown) {
      this.logger.warn('Ignoring event during shutdown');
      return;
    }

    // 1. Update relevant store (synchronous within orchestrator)
    await this.storeSynchronizer.update(event);

    // 2. Get subscription parameters based on event type
    const { subscriptionType, subscriptionPayload } =
      this.getSubscriptionParams(event);

    // 3. Get subscribed strategies
    const subscribers = await this.subscriptionManager.getSubscribers(
      subscriptionType,
      subscriptionPayload
    );

    if (subscribers.length === 0) {
      this.logger.debug(
        { eventType: event.type },
        'No subscribers for event'
      );
      return;
    }

    // 4. Dispatch to all subscribers (parallel across strategies)
    this.mailboxManager.dispatchToStrategies(subscribers, {
      type: 'external',
      event,
      subscriptionType,
      subscriptionPayload,
    });

    this.logger.debug(
      {
        eventType: event.type,
        subscriberCount: subscribers.length,
      },
      'Event dispatched to subscribers'
    );
  }

  /**
   * Process a single event from a strategy's mailbox.
   * This is called sequentially for each event in a strategy's queue.
   *
   * IMPORTANT: This processes logs IN ORDER as emitted by the strategy.
   */
  private async processMailboxEvent(
    strategyAddress: Address,
    event: MailboxEvent
  ): Promise<void> {
    if (event.type === 'external') {
      await this.deliverExternalEvent(
        strategyAddress,
        event.event,
        event.subscriptionType,
        event.subscriptionPayload
      );
    } else if (event.type === 'effect_result') {
      await this.deliverEffectResultCallback(strategyAddress, event.result);
    }
  }

  /**
   * Deliver an external event to a single strategy.
   */
  private async deliverExternalEvent(
    strategyAddress: Address,
    event: ExternalEvent,
    subscriptionType: Hex,
    subscriptionPayload: Hex
  ): Promise<void> {
    // Encode callback data based on event type
    const calldata = this.encodeCallback(event);

    // Execute callback in EVM
    const result = await this.vmRunner.callAsCore(
      strategyAddress,
      calldata,
      this.callbackGasLimit
    );

    // Handle execution result
    if (result.success) {
      // Process logs IN ORDER (as emitted by strategy)
      await this.processLogsInOrder(strategyAddress, result.logs);
    } else {
      // Check if callback doesn't exist
      if (this.isFunctionNotFoundError(result.error)) {
        await this.subscriptionManager.disableSubscription(
          strategyAddress,
          subscriptionType,
          subscriptionPayload
        );
        this.logger.warn(
          { strategy: strategyAddress },
          'Strategy missing callback, subscription disabled'
        );
      } else {
        this.logger.error(
          {
            strategy: strategyAddress,
            error: result.error,
          },
          'Callback execution failed'
        );
      }
    }

    // Record gas usage
    this.logger.debug(
      {
        strategy: strategyAddress,
        gasUsed: result.gasUsed.toString(),
      },
      'Callback gas usage'
    );
  }

  /**
   * Process logs from a callback execution IN ORDER.
   *
   * IMPORTANT: Logs are processed in emission order, NOT grouped by type.
   * A strategy might:
   * 1. Subscribe to balance updates
   * 2. Request a withdraw action
   * 3. Unsubscribe from old pool
   *
   * Order matters for correct state transitions!
   */
  private async processLogsInOrder(
    strategyAddress: Address,
    logs: Log[]
  ): Promise<void> {
    for (const log of logs) {
      const decoded = this.eventDecoder.decode(log);

      if (decoded.type === 'Unknown') {
        // Skip unknown events
        continue;
      }

      switch (decoded.type) {
        case 'SubscriptionRequested':
          await this.subscriptionManager.processLogs(strategyAddress, [log]);
          break;

        case 'UnsubscriptionRequested':
          await this.subscriptionManager.processLogs(strategyAddress, [log]);
          break;

        case 'ActionRequested':
          // Queue for async execution (maintains order within strategy)
          this.effectEngine.queueAction(strategyAddress, decoded);
          break;

        case 'LogMessage':
          // Output strategy log message
          const logMethod = getLogMethod(this.logger, decoded.level);
          logMethod(
            {
              strategy: strategyAddress,
              data: decoded.data,
            },
            `[Strategy] ${decoded.message}`
          );
          break;
      }
    }
  }

  /**
   * Deliver an effect result to a strategy.
   * Called by EffectEngine when an action completes.
   */
  private async deliverEffectResult(
    strategyAddress: Address,
    result: EffectResult
  ): Promise<void> {
    // Dispatch to the strategy's mailbox
    this.mailboxManager.dispatchToStrategy(strategyAddress, {
      type: 'effect_result',
      result,
    });
  }

  /**
   * Deliver an effect result callback to a strategy.
   */
  private async deliverEffectResultCallback(
    strategyAddress: Address,
    result: EffectResult
  ): Promise<void> {
    // Encode callback based on effect type
    // For now, use a generic callback structure
    // TODO: Determine specific callback based on action type
    const calldata = encodeFunctionData({
      abi: EFFECT_CALLBACK_ABI,
      functionName: 'onAddLiquidityComplete',
      args: [result.effectId, result.success, result.resultData],
    });

    const callResult = await this.vmRunner.callAsCore(
      strategyAddress,
      calldata,
      this.callbackGasLimit
    );

    if (callResult.success) {
      // Process any logs emitted during the callback
      await this.processLogsInOrder(strategyAddress, callResult.logs);
    } else {
      this.logger.error(
        {
          strategy: strategyAddress,
          effectId: result.effectId,
          error: callResult.error,
        },
        'Effect result callback failed'
      );
    }
  }

  /**
   * Encode a callback based on event type.
   */
  private encodeCallback(event: ExternalEvent): Hex {
    switch (event.type) {
      case 'ohlc':
        return encodeFunctionData({
          abi: OHLC_CALLBACK_ABI,
          functionName: 'onOhlcCandle',
          args: [
            event.marketId,
            event.timeframe,
            {
              timestamp: event.candle.timestamp,
              open: event.candle.open,
              high: event.candle.high,
              low: event.candle.low,
              close: event.candle.close,
              volume: event.candle.volume,
            },
          ],
        });

      case 'pool':
        // TODO: Implement pool callback encoding
        throw new Error('Pool callback not implemented');

      case 'position':
        // TODO: Implement position callback encoding
        throw new Error('Position callback not implemented');

      case 'balance':
        // TODO: Implement balance callback encoding
        throw new Error('Balance callback not implemented');

      default:
        throw new Error(`Unknown event type: ${(event as ExternalEvent).type}`);
    }
  }

  /**
   * Get subscription parameters from an external event.
   */
  private getSubscriptionParams(event: ExternalEvent): {
    subscriptionType: Hex;
    subscriptionPayload: Hex;
  } {
    switch (event.type) {
      case 'ohlc':
        return {
          subscriptionType: SUBSCRIPTION_TYPES.OHLC,
          // Payload is abi.encode(marketId, timeframe)
          subscriptionPayload: `0x${event.marketId.slice(2)}${event.timeframe
            .toString(16)
            .padStart(64, '0')}` as Hex,
        };

      case 'pool':
        return {
          subscriptionType: SUBSCRIPTION_TYPES.POOL,
          // Payload is abi.encode(poolId)
          subscriptionPayload: event.poolId,
        };

      case 'position':
        return {
          subscriptionType: SUBSCRIPTION_TYPES.POSITION,
          // Payload is abi.encode(positionId)
          subscriptionPayload: event.positionId,
        };

      case 'balance':
        return {
          subscriptionType: SUBSCRIPTION_TYPES.BALANCE,
          // Payload is abi.encode(chainId, token)
          subscriptionPayload: `0x${event.entry.chainId
            .toString(16)
            .padStart(64, '0')}${event.entry.token.slice(2).padStart(64, '0')}` as Hex,
        };

      default:
        throw new Error(`Unknown event type`);
    }
  }

  /**
   * Check if an error indicates the function doesn't exist
   */
  private isFunctionNotFoundError(error?: string): boolean {
    if (!error) return false;
    return (
      error.includes('function not found') ||
      error.includes('no matching function') ||
      error.includes('execution reverted')
    );
  }

  /**
   * Get the subscription manager for external configuration.
   * Used to connect data sources.
   */
  getSubscriptionManager(): SubscriptionManager {
    return this.subscriptionManager;
  }

  /**
   * Get mailbox statistics for monitoring.
   */
  getMailboxStats(): MailboxStats {
    return this.mailboxManager.getStats();
  }

  /**
   * Check if the orchestrator has pending work.
   */
  hasPendingWork(): boolean {
    return (
      this.mailboxManager.hasPendingWork() || this.effectEngine.pendingCount > 0
    );
  }

  /**
   * Gracefully shutdown the orchestrator.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down orchestrator...');
    this.isShuttingDown = true;

    // Wait for pending work to complete (with timeout)
    const maxWait = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.hasPendingWork() && Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.hasPendingWork()) {
      this.logger.warn('Shutdown with pending work remaining');
    }

    this.logger.info('Orchestrator shutdown complete');
  }
}
