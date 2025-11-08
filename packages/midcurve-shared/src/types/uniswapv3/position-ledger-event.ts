/**
 * Uniswap V3 Position Ledger Event Types
 *
 * Type aliases and re-exports for Uniswap V3 position ledger events.
 * Provides convenient, protocol-specific types for working with
 * Uniswap V3 position history.
 *
 * @see ../position-ledger-event.ts for the base interface
 * @see ./position-ledger-event-config.ts for config details
 * @see ./position-ledger-event-state.ts for state details
 */

import type {
  PositionLedgerEvent,
  EventType,
  Reward,
} from '../position-ledger-event.js';
import type { UniswapV3LedgerEventConfig } from './position-ledger-event-config.js';
import type {
  UniswapV3LedgerEventState,
  UniswapV3IncreaseLiquidityEvent,
  UniswapV3DecreaseLiquidityEvent,
  UniswapV3CollectEvent,
} from './position-ledger-event-state.js';

// ============================================================================
// TYPE ALIASES
// ============================================================================

/**
 * Uniswap V3 Position Ledger Event
 *
 * Type-safe ledger event for Uniswap V3 positions.
 * Enforces correct config and state types at compile time.
 *
 * Key fields for Uniswap V3:
 * - config.chainId: EVM chain (1=Ethereum, 42161=Arbitrum, 8453=Base, etc.)
 * - config.nftId: NFT Position Manager token ID
 * - config.blockNumber: Block where event occurred (for ordering)
 * - config.txIndex: Transaction index (for ordering within block)
 * - config.logIndex: Log index (for ordering within transaction)
 * - config.liquidityAfter: Cumulative liquidity after event
 * - config.sqrtPriceX96: Pool price at event time (Q96 fixed-point)
 * - state: Raw IncreaseLiquidity | DecreaseLiquidity | Collect event data
 *
 * @example
 * ```typescript
 * const event: UniswapV3LedgerEvent = {
 *   id: 'event_abc123',
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 *   positionId: 'position_xyz789',
 *   protocol: 'uniswapv3',
 *   previousId: 'event_def456', // null for first event
 *   timestamp: new Date('2024-01-15T10:30:00Z'),
 *   eventType: 'INCREASE_POSITION',
 *   inputHash: 'a1b2c3d4e5f6...',
 *   poolPrice: 2000_000000n, // 2000 USDC per WETH
 *   token0Amount: 1000_000000n, // 1000 USDC
 *   token1Amount: 500000000000000000n, // 0.5 WETH
 *   tokenValue: 2000_000000n, // 2000 USDC total value
 *   rewards: [],
 *   deltaCostBasis: 2000_000000n, // +2000 USDC invested
 *   costBasisAfter: 5000_000000n, // 5000 USDC total invested
 *   deltaPnl: 0n, // No PnL on INCREASE
 *   pnlAfter: 500_000000n, // 500 USDC cumulative realized PnL
 *   config: {
 *     chainId: 1, // Ethereum
 *     nftId: 123456n,
 *     blockNumber: 18000000n,
 *     txIndex: 45,
 *     logIndex: 12,
 *     txHash: '0xabc123...',
 *     deltaL: 1000000n, // +1M liquidity
 *     liquidityAfter: 3000000n, // 3M total liquidity
 *     feesCollected0: 0n,
 *     feesCollected1: 0n,
 *     uncollectedPrincipal0After: 0n,
 *     uncollectedPrincipal1After: 0n,
 *     sqrtPriceX96: 3543191142285914205922034323n,
 *   },
 *   state: {
 *     eventType: 'INCREASE_LIQUIDITY',
 *     tokenId: 123456n,
 *     liquidity: 1000000n,
 *     amount0: 1000_000000n,
 *     amount1: 500000000000000000n,
 *   },
 * };
 * ```
 */
export type UniswapV3LedgerEvent = PositionLedgerEvent<'uniswapv3'>;

// ============================================================================
// RE-EXPORTS FOR CONVENIENCE
// ============================================================================

/**
 * Re-export Uniswap V3 config type
 * @see ./position-ledger-event-config.ts
 */
export type { UniswapV3LedgerEventConfig };

/**
 * Re-export Uniswap V3 state types
 * @see ./position-ledger-event-state.ts
 */
export type {
  UniswapV3LedgerEventState,
  UniswapV3IncreaseLiquidityEvent,
  UniswapV3DecreaseLiquidityEvent,
  UniswapV3CollectEvent,
};

/**
 * Re-export common types
 */
export type { EventType, Reward };

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Uniswap V3 Increase Position Ledger Event
 *
 * Type narrowing helper for INCREASE_POSITION events.
 *
 * @example
 * ```typescript
 * function processIncrease(event: UniswapV3IncreaseLedgerEvent) {
 *   // TypeScript knows:
 *   // - event.eventType === 'INCREASE_POSITION'
 *   // - event.state.eventType === 'INCREASE_LIQUIDITY'
 *   // - event.config.deltaL > 0
 *   console.log(`Added liquidity: ${event.state.liquidity}`);
 * }
 * ```
 */
export type UniswapV3IncreaseLedgerEvent = UniswapV3LedgerEvent & {
  eventType: 'INCREASE_POSITION';
  state: UniswapV3IncreaseLiquidityEvent;
};

/**
 * Uniswap V3 Decrease Position Ledger Event
 *
 * Type narrowing helper for DECREASE_POSITION events.
 *
 * @example
 * ```typescript
 * function processDecrease(event: UniswapV3DecreaseLedgerEvent) {
 *   // TypeScript knows:
 *   // - event.eventType === 'DECREASE_POSITION'
 *   // - event.state.eventType === 'DECREASE_LIQUIDITY'
 *   // - event.config.deltaL < 0
 *   console.log(`Removed liquidity: ${event.state.liquidity}`);
 *   console.log(`Realized PnL: ${event.deltaPnl}`);
 * }
 * ```
 */
export type UniswapV3DecreaseLedgerEvent = UniswapV3LedgerEvent & {
  eventType: 'DECREASE_POSITION';
  state: UniswapV3DecreaseLiquidityEvent;
};

/**
 * Uniswap V3 Collect Ledger Event
 *
 * Type narrowing helper for COLLECT events.
 *
 * @example
 * ```typescript
 * function processCollect(event: UniswapV3CollectLedgerEvent) {
 *   // TypeScript knows:
 *   // - event.eventType === 'COLLECT'
 *   // - event.state.eventType === 'COLLECT'
 *   // - event.rewards contains separated fees
 *   console.log(`Collected to: ${event.state.recipient}`);
 *   console.log(`Fee value: ${event.rewards[0]?.tokenValue || 0n}`);
 * }
 * ```
 */
export type UniswapV3CollectLedgerEvent = UniswapV3LedgerEvent & {
  eventType: 'COLLECT';
  state: UniswapV3CollectEvent;
};
