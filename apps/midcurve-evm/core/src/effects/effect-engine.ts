import type { Address, Hex } from 'viem';
import type pino from 'pino';
import type {
  IEffectExecutor,
  QueuedAction,
  EffectResult,
} from './types.js';
import type { ActionRequestedEvent } from '../events/types.js';

/**
 * Callback invoked when an effect completes execution.
 * Used to deliver the result back to the strategy.
 */
export type OnEffectCompleteCallback = (
  strategyAddress: Address,
  result: EffectResult
) => Promise<void>;

/**
 * EffectEngine manages the execution of actions emitted by strategies.
 *
 * Responsibilities:
 * - Queue actions for asynchronous execution
 * - Execute actions using the configured executor (mock or real)
 * - Deliver results back to strategies via callbacks
 *
 * Note: Actions within a single strategy are processed in order,
 * but actions from different strategies can run in parallel.
 */
export class EffectEngine {
  /** Pending actions waiting to be executed */
  private pendingActions: QueuedAction[] = [];

  /** Actions currently being processed */
  private processingActions: Map<Hex, QueuedAction> = new Map();

  /** Whether the engine is currently processing actions */
  private isProcessing = false;

  constructor(
    private executor: IEffectExecutor,
    private logger: pino.Logger,
    private onEffectComplete?: OnEffectCompleteCallback
  ) {}

  /**
   * Queue an action for execution.
   *
   * @param strategyAddress The strategy that emitted this action
   * @param event The decoded ActionRequested event
   */
  queueAction(strategyAddress: Address, event: ActionRequestedEvent): void {
    // Extract effectId from the payload (first 32 bytes after encoding overhead)
    // The payload is abi.encode(effectId, ...) so effectId is the first parameter
    const effectId = this.extractEffectId(event.payload);

    const action: QueuedAction = {
      effectId,
      strategyAddress,
      actionType: event.actionType,
      payload: event.payload,
      queuedAt: Date.now(),
    };

    this.pendingActions.push(action);

    this.logger.debug(
      {
        effectId,
        strategy: strategyAddress,
        actionType: event.actionType,
        queueLength: this.pendingActions.length,
      },
      'Action queued'
    );

    // Trigger processing if not already running
    this.processQueue();
  }

  /**
   * Process pending actions.
   * This runs asynchronously and processes actions one at a time.
   */
  private async processQueue(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.pendingActions.length > 0) {
        const action = this.pendingActions.shift()!;

        // Track that we're processing this action
        this.processingActions.set(action.effectId, action);

        try {
          // Execute the action
          const result = await this.executor.execute(action);

          this.logger.info(
            {
              effectId: action.effectId,
              strategy: action.strategyAddress,
              success: result.success,
              txHash: result.txHash,
            },
            'Effect executed'
          );

          // Deliver result to the strategy
          if (this.onEffectComplete) {
            await this.onEffectComplete(action.strategyAddress, result);
          }
        } catch (error) {
          this.logger.error(
            {
              effectId: action.effectId,
              strategy: action.strategyAddress,
              error,
            },
            'Effect execution failed'
          );

          // Create failure result
          const failureResult: EffectResult = {
            effectId: action.effectId,
            success: false,
            errorMessage:
              error instanceof Error ? error.message : 'Unknown error',
            resultData: '0x' as Hex,
          };

          // Still deliver the failure to the strategy
          if (this.onEffectComplete) {
            await this.onEffectComplete(action.strategyAddress, failureResult);
          }
        } finally {
          this.processingActions.delete(action.effectId);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Set the callback for when effects complete.
   */
  setOnEffectComplete(callback: OnEffectCompleteCallback): void {
    this.onEffectComplete = callback;
  }

  /**
   * Get the number of pending actions
   */
  get pendingCount(): number {
    return this.pendingActions.length;
  }

  /**
   * Get the number of actions currently being processed
   */
  get processingCount(): number {
    return this.processingActions.size;
  }

  /**
   * Check if an effect is pending or processing
   */
  isEffectPending(effectId: Hex): boolean {
    return (
      this.processingActions.has(effectId) ||
      this.pendingActions.some((a) => a.effectId === effectId)
    );
  }

  /**
   * Extract effectId from ABI-encoded payload.
   * The effectId is always the first bytes32 parameter.
   */
  private extractEffectId(payload: Hex): Hex {
    // ABI-encoded bytes32 is exactly 64 hex chars (32 bytes) starting at position 2 (after 0x)
    // First 32 bytes of the payload is the effectId
    if (payload.length < 66) {
      // 0x + 64 chars
      this.logger.warn({ payload }, 'Payload too short to extract effectId');
      return '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
    }
    return `0x${payload.slice(2, 66)}` as Hex;
  }
}
