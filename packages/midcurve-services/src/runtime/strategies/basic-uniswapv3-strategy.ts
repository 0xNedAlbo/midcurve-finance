/**
 * Basic Uniswap V3 Strategy Implementation
 *
 * A simple strategy for managing Uniswap V3 positions with:
 * - Automatic fee collection when threshold is met
 * - Out-of-range detection and optional rebalancing
 * - Position status tracking
 */

import type { BasicUniswapV3StrategyState } from '@midcurve/shared';
import { createInitialBasicUniswapV3State } from '@midcurve/shared';
import type {
  StrategyImplementation,
  StrategyContext,
} from '../strategy-implementation.js';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * External state for BasicUniswapV3 strategy
 *
 * Contains read-only data about the pool and position.
 */
export interface BasicUniswapV3ExternalState {
  /** Current pool tick */
  currentTick: number | null;
  /** Pool tick spacing */
  tickSpacing: number;
  /** Position lower tick */
  tickLower: number;
  /** Position upper tick */
  tickUpper: number;
  /** Current unclaimed fees (in quote token units) */
  unclaimedFees: bigint;
  /** Fee collection threshold (in quote token units) */
  feeCollectionThreshold: bigint;
  /** Base token symbol for OHLC subscription */
  baseTokenSymbol: string;
}

/**
 * BasicUniswapV3 Strategy Implementation
 *
 * Core logic:
 * 1. Monitor pool tick via OHLC events
 * 2. Track if position is in range
 * 3. Collect fees when threshold is reached
 * 4. Handle user actions (collect, compound, rebalance)
 */
export class BasicUniswapV3StrategyImpl
  implements
    StrategyImplementation<'basicUniswapV3', BasicUniswapV3ExternalState>
{
  readonly strategyType = 'basicUniswapV3' as const;
  private readonly logger: ServiceLogger;

  constructor() {
    this.logger = createServiceLogger('BasicUniswapV3Strategy');
  }

  /**
   * Process an event and return new state
   */
  async run(
    ctx: StrategyContext<'basicUniswapV3', BasicUniswapV3ExternalState>
  ): Promise<BasicUniswapV3StrategyState> {
    const { event, localState } = ctx;

    this.logger.debug(
      { strategyId: ctx.strategyId, eventType: event.eventType },
      'Processing event'
    );

    // Handle different event types
    switch (event.eventType) {
      case 'ohlc':
        return this.handleOhlcEvent(ctx);

      case 'action':
        return this.handleActionEvent(ctx);

      case 'effect':
        return this.handleEffectEvent(ctx);

      case 'position':
        return this.handlePositionEvent(ctx);

      case 'funding':
        // Funding events don't change state for now
        return localState;

      default:
        this.logger.warn(
          { eventType: (event as { eventType: string }).eventType },
          'Unknown event type'
        );
        return localState;
    }
  }

  /**
   * Initialize strategy when activated
   */
  async initialize(
    ctx: Omit<
      StrategyContext<'basicUniswapV3', BasicUniswapV3ExternalState>,
      'event'
    >
  ): Promise<BasicUniswapV3StrategyState> {
    const { externalState, api } = ctx;

    this.logger.info(
      { strategyId: ctx.strategyId },
      'Initializing BasicUniswapV3 strategy'
    );

    // Subscribe to OHLC for the base token (from external state)
    if (externalState.baseTokenSymbol) {
      api.subscribeOhlc({
        symbol: externalState.baseTokenSymbol,
        timeframe: '1m',
      });
    }

    // Return initial state
    return createInitialBasicUniswapV3State();
  }

  /**
   * Clean up when strategy is stopped
   */
  async shutdown(
    ctx: Omit<
      StrategyContext<'basicUniswapV3', BasicUniswapV3ExternalState>,
      'event'
    >
  ): Promise<void> {
    const { externalState, api } = ctx;

    this.logger.info(
      { strategyId: ctx.strategyId },
      'Shutting down BasicUniswapV3 strategy'
    );

    // Unsubscribe from OHLC
    if (externalState.baseTokenSymbol) {
      api.unsubscribeOhlc({
        symbol: externalState.baseTokenSymbol,
        timeframe: '1m',
      });
    }
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Handle OHLC market data event
   *
   * Updates tick tracking and checks if position is in range.
   */
  private async handleOhlcEvent(
    ctx: StrategyContext<'basicUniswapV3', BasicUniswapV3ExternalState>
  ): Promise<BasicUniswapV3StrategyState> {
    const { localState, externalState, api } = ctx;

    // Update tick tracking
    const currentTick = externalState.currentTick;
    if (currentTick === null) {
      return localState;
    }

    // Check if in range
    const isInRange =
      currentTick >= externalState.tickLower &&
      currentTick < externalState.tickUpper;

    // Check if we should collect fees
    const shouldCollect =
      localState.pendingEffectId === null &&
      externalState.unclaimedFees >= externalState.feeCollectionThreshold;

    let newState: BasicUniswapV3StrategyState = {
      ...localState,
      lastKnownTick: currentTick,
      isInRange,
      lastSuccessfulRunAt: Date.now(),
    };

    // Trigger fee collection if needed
    if (shouldCollect && localState.positionId) {
      const effectId = api.startEffect({
        effectType: 'uniswapv3:collect',
        payload: {
          positionId: localState.positionId,
        },
        timeoutMs: 120000,
      });

      newState = {
        ...newState,
        pendingEffectId: effectId,
      };

      api.log('info', `Started fee collection effect: ${effectId}`);
    }

    return newState;
  }

  /**
   * Handle user action event
   */
  private async handleActionEvent(
    ctx: StrategyContext<'basicUniswapV3', BasicUniswapV3ExternalState>
  ): Promise<BasicUniswapV3StrategyState> {
    const { event, localState, api } = ctx;

    if (event.eventType !== 'action') {
      return localState;
    }

    const { actionId, actionType, payload } = event;

    // Track pending action
    let newState: BasicUniswapV3StrategyState = {
      ...localState,
      pendingActionId: actionId,
    };

    switch (actionType) {
      case 'collect': {
        if (!localState.positionId) {
          api.log('warn', 'Cannot collect: no position');
          return { ...newState, pendingActionId: null };
        }

        const effectId = api.startEffect({
          effectType: 'uniswapv3:collect',
          payload: { positionId: localState.positionId },
          timeoutMs: 120000,
        });

        return {
          ...newState,
          pendingEffectId: effectId,
        };
      }

      case 'compound': {
        if (!localState.positionId) {
          api.log('warn', 'Cannot compound: no position');
          return { ...newState, pendingActionId: null };
        }

        const effectId = api.startEffect({
          effectType: 'uniswapv3:compound',
          payload: { positionId: localState.positionId },
          timeoutMs: 180000,
        });

        return {
          ...newState,
          pendingEffectId: effectId,
        };
      }

      case 'rebalance': {
        const effectId = api.startEffect({
          effectType: 'uniswapv3:rebalance',
          payload: {
            positionId: localState.positionId,
            ...(payload as object),
          },
          timeoutMs: 300000,
        });

        return {
          ...newState,
          pendingEffectId: effectId,
        };
      }

      case 'closePosition': {
        if (!localState.positionId) {
          api.log('warn', 'Cannot close: no position');
          return { ...newState, pendingActionId: null };
        }

        const effectId = api.startEffect({
          effectType: 'uniswapv3:close',
          payload: { positionId: localState.positionId },
          timeoutMs: 180000,
        });

        return {
          ...newState,
          pendingEffectId: effectId,
        };
      }

      default:
        api.log('warn', `Unknown action type: ${actionType}`);
        return { ...newState, pendingActionId: null };
    }
  }

  /**
   * Handle effect result event
   */
  private async handleEffectEvent(
    ctx: StrategyContext<'basicUniswapV3', BasicUniswapV3ExternalState>
  ): Promise<BasicUniswapV3StrategyState> {
    const { event, localState, api } = ctx;

    if (event.eventType !== 'effect') {
      return localState;
    }

    const { effectId, effectEventType, error } = event;

    // Verify this is our pending effect
    if (effectId !== localState.pendingEffectId) {
      api.log('warn', `Received effect result for unknown effect: ${effectId}`);
      return localState;
    }

    // Clear pending effect and action
    let newState: BasicUniswapV3StrategyState = {
      ...localState,
      pendingEffectId: null,
      pendingActionId: null,
    };

    switch (effectEventType) {
      case 'success':
        api.log('info', `Effect ${effectId} succeeded`);
        newState = {
          ...newState,
          lastError: null,
          lastSuccessfulRunAt: Date.now(),
        };
        break;

      case 'error':
        api.log('error', `Effect ${effectId} failed: ${JSON.stringify(error)}`);
        newState = {
          ...newState,
          lastError: String(error),
        };
        break;

      case 'timeout':
        api.log('error', `Effect ${effectId} timed out`);
        newState = {
          ...newState,
          lastError: 'Effect timed out',
        };
        break;
    }

    return newState;
  }

  /**
   * Handle position event (on-chain updates)
   */
  private async handlePositionEvent(
    ctx: StrategyContext<'basicUniswapV3', BasicUniswapV3ExternalState>
  ): Promise<BasicUniswapV3StrategyState> {
    const { event, localState, api } = ctx;

    if (event.eventType !== 'position') {
      return localState;
    }

    const { positionId, positionEventType } = event;

    api.log('info', `Position event: ${positionEventType} for ${positionId}`);

    // Track the position if this is our first event for it
    if (!localState.positionId) {
      return {
        ...localState,
        positionId,
      };
    }

    // Position events are informational for now
    // The position service handles state updates
    return {
      ...localState,
      lastSuccessfulRunAt: Date.now(),
    };
  }
}
