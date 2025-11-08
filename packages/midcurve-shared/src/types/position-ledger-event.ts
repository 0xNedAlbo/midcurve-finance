/**
 * Position Ledger Event - Abstract interface for position event tracking
 *
 * This interface tracks individual events in a position's history, enabling:
 * - Cost basis tracking (capital invested vs current value)
 * - PnL calculations (realized and unrealized gains/losses)
 * - Fee accounting (separating fees from principal)
 * - Event sequencing (linked list via previousId)
 * - Historical analysis and auditing
 *
 * Supported protocols:
 * - Uniswap V3 (Ethereum, Arbitrum, Base, BSC, Polygon, Optimism)
 * - Future: Orca (Solana), Raydium (Solana), PancakeSwap V3 (BSC)
 *
 * Design Pattern:
 * - Common fields: Shared across all protocols
 * - config: Protocol-specific immutable configuration (JSON)
 * - state: Protocol-specific raw event data (JSON)
 * - Mapped types ensure config/state match the protocol
 *
 * Event Sequencing:
 * - Events form a linked list via previousId (can traverse history)
 * - Events are ordered by timestamp (and blockchain ordering)
 * - Each event builds upon the previous event's state
 *
 * Financial Tracking:
 * - Cost basis: How much capital was invested
 * - PnL: Realized (locked in) + Unrealized (current market value)
 * - Fees: Tracked separately from principal for accurate accounting
 *
 * @see position-ledger-event-config.ts for protocol-specific config types
 * @see position-ledger-event-state.ts for protocol-specific state types
 */

import type { PositionLedgerEventConfigMap } from './position-ledger-event-config.js';
import type { PositionLedgerEventStateMap } from './position-ledger-event-state.js';

// Re-export for convenience
export type { PositionLedgerEventConfigMap } from './position-ledger-event-config.js';
export type { PositionLedgerEventStateMap } from './position-ledger-event-state.js';

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Position Event Types
 *
 * Represents the three types of events that can occur on a concentrated liquidity position:
 *
 * - INCREASE_POSITION: Liquidity added to position (capital deployed)
 *   - Increases cost basis
 *   - Does not realize PnL
 *   - Increases liquidity
 *
 * - DECREASE_POSITION: Liquidity removed from position (partial close)
 *   - Decreases cost basis proportionally
 *   - Realizes PnL (locks in gains/losses)
 *   - Decreases liquidity
 *   - Adds tokens to "uncollected principal" pool
 *
 * - COLLECT: Tokens withdrawn from position (fees + principal)
 *   - Does not affect cost basis
 *   - Does not realize PnL
 *   - Reduces uncollected principal
 *   - Separates fees from principal for accurate accounting
 */
export type EventType = 'INCREASE_POSITION' | 'DECREASE_POSITION' | 'COLLECT';

// ============================================================================
// REWARD STRUCTURE
// ============================================================================

/**
 * Reward
 *
 * Represents a reward token collected from a position (e.g., liquidity mining rewards).
 *
 * Note: For Uniswap V3, rewards typically refer to fees collected.
 * Future protocols may have native reward tokens (e.g., governance tokens).
 */
export interface Reward {
  /**
   * Token identifier
   * For ERC-20: token address
   * For Solana SPL: mint address
   */
  tokenId: string;

  /**
   * Amount of reward token
   * In smallest token units (e.g., wei for WETH)
   */
  tokenAmount: bigint;

  /**
   * Value of reward in quote token units
   * Calculated at time of event using pool price
   * In smallest quote token units
   */
  tokenValue: bigint;
}

// ============================================================================
// POSITION LEDGER EVENT INTERFACE
// ============================================================================

/**
 * Position Ledger Event
 *
 * Represents a single event in a position's history.
 * Events form a linked list (via previousId) and are processed sequentially.
 *
 * Type safety: PositionLedgerEvent<'uniswapv3'> can only have:
 * - protocol: 'uniswapv3'
 * - config: UniswapV3LedgerEventConfig
 * - state: UniswapV3LedgerEventState
 *
 * Invalid combinations (e.g., Uniswap config with Orca state) are prevented at compile time.
 *
 * @template P - Protocol key from PositionLedgerEventConfigMap ('uniswapv3', etc.)
 *
 * @example
 * ```typescript
 * // Type-safe Uniswap V3 event
 * const event: PositionLedgerEvent<'uniswapv3'> = {
 *   id: 'event_123',
 *   protocol: 'uniswapv3',
 *   eventType: 'INCREASE_POSITION',
 *   config: {
 *     chainId: 1,
 *     nftId: 123456n,
 *     blockNumber: 18000000n,
 *     // ... other Uniswap V3 config fields
 *   },
 *   state: {
 *     eventType: 'INCREASE_LIQUIDITY',
 *     tokenId: 123456n,
 *     liquidity: 1000000n,
 *     amount0: 500000n,
 *     amount1: 1000000000n,
 *   },
 *   // ... other common fields
 * };
 * ```
 */
export interface PositionLedgerEvent<P extends keyof PositionLedgerEventConfigMap> {
  // ==========================================================================
  // DATABASE FIELDS
  // ==========================================================================

  /**
   * Unique identifier (cuid)
   * Generated by database on creation
   */
  id: string;

  /**
   * Timestamp when event was created in database
   */
  createdAt: Date;

  /**
   * Timestamp when event was last updated in database
   */
  updatedAt: Date;

  // ==========================================================================
  // POSITION REFERENCE
  // ==========================================================================

  /**
   * Position this event belongs to
   * Foreign key reference to Position.id
   */
  positionId: string;

  // ==========================================================================
  // PROTOCOL IDENTIFICATION
  // ==========================================================================

  /**
   * Protocol identifier
   * Must match the generic parameter P
   * Identifies which DEX protocol this event belongs to
   *
   * @example 'uniswapv3'
   */
  protocol: P;

  // ==========================================================================
  // EVENT CHAINING
  // ==========================================================================

  /**
   * Previous event in the chain
   * null for the first event (position creation)
   *
   * Forms a linked list: event1 → event2 → event3 → ...
   * Enables traversing event history and building state from genesis
   */
  previousId: string | null;

  // ==========================================================================
  // EVENT IDENTIFICATION
  // ==========================================================================

  /**
   * Timestamp when event occurred on blockchain
   * Used for ordering events and time-based queries
   */
  timestamp: Date;

  /**
   * Type of event
   * Determines how this event affects the position's financial state
   *
   * @see EventType for detailed descriptions
   */
  eventType: EventType;

  /**
   * Input hash for deduplication
   * Uniquely identifies this event based on blockchain coordinates
   *
   * Format: Protocol-specific (e.g., MD5(positionId + blockNumber + txIndex + logIndex))
   * Purpose: Prevents duplicate event processing across restarts/deployments
   */
  inputHash: string;

  // ==========================================================================
  // FINANCIAL DATA
  // ==========================================================================

  /**
   * Pool price at time of event
   * Expressed as: quote token units per 1 base token (in smallest units)
   *
   * Used for:
   * - Calculating token values in quote currency
   * - PnL calculations
   * - Fee value calculations
   *
   * @example
   * // Pool: WETH/USDC, quote token = USDC
   * // Price: 2000 USDC per 1 WETH
   * // USDC has 6 decimals, WETH has 18 decimals
   * poolPrice = 2000_000000n // 2000 * 10^6
   */
  poolPrice: bigint;

  /**
   * Amount of token0 involved in event
   * In smallest token units (e.g., wei for WETH)
   *
   * Meaning varies by event type:
   * - INCREASE_POSITION: Amount deposited
   * - DECREASE_POSITION: Amount removed (added to uncollected principal)
   * - COLLECT: Amount collected (principal + fees)
   */
  token0Amount: bigint;

  /**
   * Amount of token1 involved in event
   * In smallest token units
   *
   * See token0Amount for meaning by event type
   */
  token1Amount: bigint;

  /**
   * Total value of tokens in quote currency
   * In smallest quote token units
   *
   * Calculated as:
   * - If token0 is quote: token0Amount + (token1Amount * poolPrice)
   * - If token1 is quote: token1Amount + (token0Amount * poolPrice)
   *
   * Used for PnL and cost basis calculations
   */
  tokenValue: bigint;

  /**
   * Rewards collected in this event
   * Typically empty for INCREASE/DECREASE, populated for COLLECT
   *
   * For Uniswap V3: Represents pure fees (separated from principal)
   * For other protocols: May include liquidity mining rewards, governance tokens, etc.
   */
  rewards: Reward[];

  // ==========================================================================
  // COST BASIS TRACKING
  // ==========================================================================

  /**
   * Change in cost basis from this event
   * In smallest quote token units
   *
   * - INCREASE_POSITION: +tokenValue (capital deployed)
   * - DECREASE_POSITION: -proportionalCostBasis (capital returned)
   * - COLLECT: 0 (fees don't affect cost basis)
   *
   * Proportional cost basis = (currentCostBasis * deltaL) / currentLiquidity
   */
  deltaCostBasis: bigint;

  /**
   * Total cost basis after this event
   * Cumulative sum of all deltaCostBasis values
   * In smallest quote token units
   *
   * Represents total capital invested in the position at this point in time
   */
  costBasisAfter: bigint;

  // ==========================================================================
  // PNL TRACKING
  // ==========================================================================

  /**
   * Change in realized PnL from this event
   * In smallest quote token units
   *
   * - INCREASE_POSITION: 0 (no realization)
   * - DECREASE_POSITION: tokenValue - proportionalCostBasis (locks in gain/loss)
   * - COLLECT: 0 (fees tracked separately in rewards)
   *
   * Positive = profit, Negative = loss
   */
  deltaPnl: bigint;

  /**
   * Total realized PnL after this event
   * Cumulative sum of all deltaPnl values
   * In smallest quote token units
   *
   * Represents total locked-in gains/losses at this point in time
   * Does not include:
   * - Unrealized PnL (current position value vs cost basis)
   * - Fees (tracked separately in rewards)
   */
  pnlAfter: bigint;

  // ==========================================================================
  // PROTOCOL-SPECIFIC DATA
  // ==========================================================================

  /**
   * Protocol-specific configuration (JSON) - IMMUTABLE
   *
   * Contains immutable event metadata specific to the protocol:
   * - Uniswap V3: chainId, nftId, blockNumber, txIndex, logIndex, txHash,
   *               deltaL, liquidityAfter, feesCollected0/1,
   *               uncollectedPrincipal0/1After, sqrtPriceX96
   *
   * Type is determined by the protocol parameter P.
   * For PositionLedgerEvent<'uniswapv3'>, this will be UniswapV3LedgerEventConfig.
   *
   * @see position-ledger-event-config.ts for specific config types
   */
  config: PositionLedgerEventConfigMap[P]['config'];

  /**
   * Protocol-specific state (JSON) - RAW EVENT DATA
   *
   * Contains raw blockchain event data:
   * - Uniswap V3: IncreaseLiquidity | DecreaseLiquidity | Collect event data
   *
   * Type is determined by the protocol parameter P.
   * For PositionLedgerEvent<'uniswapv3'>, this will be UniswapV3LedgerEventState.
   *
   * Purpose:
   * - Auditability (can verify calculations against raw data)
   * - Event replay (can recalculate if needed)
   * - Analytics (access to all event parameters)
   *
   * Note: For TypeScript, state uses bigint. In database, bigint values are stored as strings.
   *
   * @see position-ledger-event-state.ts for specific state types
   */
  state: PositionLedgerEventStateMap[P]['state'];
}

// ============================================================================
// TYPE ALIASES
// ============================================================================

/**
 * Uniswap V3 Position Ledger Event
 *
 * Type-safe ledger event with Uniswap V3 configuration and state.
 * Equivalent to PositionLedgerEvent<'uniswapv3'>.
 *
 * @example
 * ```typescript
 * const event: UniswapV3LedgerEvent = {
 *   protocol: 'uniswapv3',
 *   eventType: 'INCREASE_POSITION',
 *   config: {
 *     chainId: 1,
 *     nftId: 123456n,
 *     // ... other Uniswap V3 config
 *   },
 *   state: {
 *     eventType: 'INCREASE_LIQUIDITY',
 *     // ... Uniswap V3 event data
 *   },
 *   // ... other common fields
 * };
 * ```
 */
export type UniswapV3LedgerEvent = PositionLedgerEvent<'uniswapv3'>;

/**
 * Union type for any position ledger event
 *
 * Can be an event from any supported protocol.
 * Use protocol field for type narrowing.
 *
 * @example
 * ```typescript
 * function processEvent(event: AnyLedgerEvent) {
 *   if (event.protocol === 'uniswapv3') {
 *     // TypeScript knows event is UniswapV3LedgerEvent
 *     console.log(`Block: ${event.config.blockNumber}`);
 *   }
 * }
 * ```
 */
export type AnyLedgerEvent = PositionLedgerEvent<keyof PositionLedgerEventConfigMap>;

// ============================================================================
// PROTOCOL TYPE
// ============================================================================

/**
 * Protocol identifier for ledger events
 * Derived from PositionLedgerEventConfigMap keys for type safety
 */
export type LedgerEventProtocol = keyof PositionLedgerEventConfigMap;
