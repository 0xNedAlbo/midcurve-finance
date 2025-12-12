/**
 * Position Type Definitions
 *
 * Generic position interface for concentrated liquidity positions.
 * Supports multiple protocols: Uniswap V3, Orca, Raydium, PancakeSwap V3.
 *
 * Design:
 * - Common fields: Shared across all protocols
 * - config: Protocol-specific configuration (JSON)
 *
 * @see position-config.ts for protocol-specific config types
 */

import type { PositionConfigMap } from './position-config.js';

// Re-export PositionConfigMap for use in service layer
export type { PositionConfigMap } from './position-config.js';

/**
 * Position interface
 *
 * Represents a concentrated liquidity position across any supported protocol.
 * Uses mapped types to enforce correct config/state pairing per protocol.
 *
 * Type safety: Position<'uniswapv3'> can only have UniswapV3PositionConfig
 * and UniswapV3PositionState. Invalid combinations (e.g., Uniswap config with
 * Orca state) are prevented at compile time.
 *
 * @template P - Protocol key from PositionConfigMap ('uniswapv3', etc.)
 */
export interface Position<P extends keyof PositionConfigMap> {
  /**
   * Unique identifier (database-generated)
   */
  id: string;

  /**
   * Creation timestamp
   */
  createdAt: Date;

  /**
   * Last update timestamp
   */
  updatedAt: Date;

  /**
   * Position hash for fast database lookups
   *
   * Human-readable composite key that uniquely identifies the position.
   * Format is protocol-specific:
   * - UniswapV3: "uniswapv3/{chainId}/{nftId}"
   * - Orca (future): "orca/{programId}/{positionPubkey}"
   *
   * Used for efficient indexed lookups instead of slow JSONB queries.
   *
   * @example
   * // Ethereum UniswapV3 position NFT #123456
   * positionHash = "uniswapv3/1/123456"
   *
   * // Arbitrum UniswapV3 position NFT #4865121
   * positionHash = "uniswapv3/42161/4865121"
   */
  positionHash: string;

  // ============================================================================
  // PROTOCOL IDENTIFICATION
  // ============================================================================

  /**
   * Protocol identifier
   * Specifies which DEX protocol this position belongs to
   *
   * @example 'uniswapv3'
   */
  protocol: P;

  /**
   * Position type
   * Specifies the liquidity model used by the position
   *
   * Currently only 'CL_TICKS' (concentrated liquidity with tick-based ranges)
   * is supported. Other types may be added in the future.
   *
   * @example 'CL_TICKS'
   */
  positionType: PositionType;

  // ============================================================================
  // DATA OWNERSHIP
  // ============================================================================

  /**
   * User who owns this position
   * Foreign key reference to User.id
   */
  userId: string;

  /**
   * Optional strategy reference
   * If set, this position is managed by an automated strategy.
   * Null for manual/non-automated positions.
   */
  strategyId: string | null;

  // ============================================================================
  // PNL RELATED FIELDS
  // ============================================================================

  /**
   * Current position value in quote token units (smallest denomination)
   *
   * This represents the current market value of the position if it were
   * closed at the current pool price.
   *
   * @example
   * // Position worth 1500 USDC (6 decimals)
   * currentValue = 1500_000000n
   */
  currentValue: bigint;

  /**
   * Current cost basis in quote token units (smallest denomination)
   *
   * This represents the total capital invested in the position.
   * Updated when liquidity is added or removed.
   *
   * @example
   * // Invested 1000 USDC (6 decimals)
   * currentCostBasis = 1000_000000n
   */
  currentCostBasis: bigint;

  /**
   * Realized PnL in quote token units (smallest denomination)
   *
   * Profit or loss that has been "locked in" through position changes
   * (partial closes, liquidity reductions).
   *
   * @example
   * // Realized 50 USDC profit (6 decimals)
   * realizedPnl = 50_000000n
   */
  realizedPnl: bigint;

  /**
   * Unrealized PnL in quote token units (smallest denomination)
   *
   * Current profit or loss based on current market price.
   * Formula: currentValue - currentCostBasis
   *
   * @example
   * // Current unrealized profit of 500 USDC (6 decimals)
   * unrealizedPnl = 500_000000n
   */
  unrealizedPnl: bigint;

  // ============================================================================
  // GENERAL CASH FLOW FIELDS (for non-AMM protocols)
  // ============================================================================

  /**
   * Realized cash flow in quote token units (smallest denomination)
   *
   * Cash flow additions/reductions that have been locked in (collected/paid).
   * For perpetual protocols (Hyperliquid): funding payments received/paid
   * For lending protocols: interest earned/paid
   *
   * For AMM protocols (UniswapV3): Always 0n (fees tracked separately in collectedFees)
   *
   * Total Realized PnL = realizedPnl + realizedCashflow
   *
   * @example
   * // Received 50 USDC in funding payments (6 decimals)
   * realizedCashflow = 50_000000n
   *
   * // Paid 25 USDC in funding (negative)
   * realizedCashflow = -25_000000n
   */
  realizedCashflow: bigint;

  /**
   * Unrealized cash flow in quote token units (smallest denomination)
   *
   * Cash flow additions/reductions that are pending (accrued but not collected).
   * For perpetual protocols (Hyperliquid): accrued funding payments
   * For lending protocols: accrued interest
   *
   * For AMM protocols (UniswapV3): Always 0n (fees tracked separately in unClaimedFees)
   *
   * Total Unrealized PnL = unrealizedPnl + unrealizedCashflow
   *
   * @example
   * // 10 USDC in accrued funding payments (6 decimals)
   * unrealizedCashflow = 10_000000n
   */
  unrealizedCashflow: bigint;

  // ============================================================================
  // CASH FLOW RELATED FIELDS (AMM fees)
  // ============================================================================

  /**
   * Total fees collected (claimed) in quote token units (smallest denomination)
   *
   * Historical sum of all fees that have been collected from the pool.
   *
   * @example
   * // Collected 25 USDC in fees (6 decimals)
   * collectedFees = 25_000000n
   */
  collectedFees: bigint;

  /**
   * Unclaimed fees in quote token units (smallest denomination)
   *
   * Fees that have accrued but haven't been collected yet.
   *
   * @example
   * // 5 USDC in unclaimed fees (6 decimals)
   * unClaimedFees = 5_000000n
   */
  unClaimedFees: bigint;

  /**
   * Timestamp of last fee collection
   *
   * Used for APR calculations. Defaults to positionOpenedAt if fees have
   * never been collected.
   */
  lastFeesCollectedAt: Date;

  /**
   * Total APR (time-weighted across all periods + unrealized)
   *
   * Combines realized APR (from completed fee collection periods) and
   * unrealized APR (from current unclaimed fees) using time-weighting
   * to provide a single, comprehensive APR metric.
   *
   * Null if position history is too short for reliable calculation
   * (typically < 5 minutes of active history).
   *
   * This is a platform-independent metric that works across all protocols.
   * Calculated in the service layer during position refresh.
   *
   * @example
   * // Position with 25% APR
   * totalApr = 25.03
   *
   * // Position too new for reliable APR
   * totalApr = null
   */
  totalApr: number | null;

  // ============================================================================
  // PRICE RANGE
  // ============================================================================

  /**
   * Lower bound of price range in quote token units per 1 base token
   *
   * The minimum price at which the position provides liquidity.
   * Price is expressed as: quote tokens per 1 base token (in smallest units).
   *
   * @example
   * // Lower price: 1500 USDC per 1 ETH (USDC has 6 decimals, ETH has 18)
   * // Formula: 1500 * 10^6 / 10^18 = 1500 * 10^6
   * priceRangeLower = 1500_000000n
   */
  priceRangeLower: bigint;

  /**
   * Upper bound of price range in quote token units per 1 base token
   *
   * The maximum price at which the position provides liquidity.
   * Price is expressed as: quote tokens per 1 base token (in smallest units).
   *
   * @example
   * // Upper price: 2000 USDC per 1 ETH (USDC has 6 decimals, ETH has 18)
   * priceRangeUpper = 2000_000000n
   */
  priceRangeUpper: bigint;

  // ============================================================================
  // POOL AND TOKEN ROLES
  // ============================================================================

  /**
   * Pool this position belongs to
   * Full Pool object with embedded Token objects (token0, token1)
   *
   * Type is determined by the protocol parameter P via PositionConfigMap.
   * For Position<'uniswapv3'>, this will be UniswapV3Pool.
   *
   * The pool includes:
   * - pool.token0: Full token object (including id, symbol, decimals, config, etc.)
   * - pool.token1: Full token object
   * - pool.config: Pool configuration (address, chainId, tickSpacing, etc.)
   * - pool.state: Pool state (sqrtPriceX96, liquidity, currentTick, etc.)
   */
  pool: PositionConfigMap[P]['pool'];

  /**
   * Token role indicator
   *
   * Determines which token in the pool is the quote token (unit of account):
   * - true: token0 is quote, token1 is base
   * - false: token0 is base, token1 is quote
   *
   * Use this to derive token roles:
   * ```typescript
   * const baseToken = position.isToken0Quote ? position.pool.token1 : position.pool.token0;
   * const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;
   * ```
   *
   * @example
   * // ETH/USDC pool where USDC is quote
   * // pool.token0 = USDC (0xA0b8...), pool.token1 = WETH (0xC02a...)
   * // isToken0Quote = true
   * // Therefore: baseToken = WETH, quoteToken = USDC
   */
  isToken0Quote: boolean;

  // ============================================================================
  // POSITION STATE
  // ============================================================================

  /**
   * Timestamp when position was opened
   */
  positionOpenedAt: Date;

  /**
   * Timestamp when position was closed
   * Null if position is still active
   */
  positionClosedAt: Date | null;

  /**
   * Whether the position is currently active
   *
   * true: Position is open and providing liquidity
   * false: Position has been closed
   */
  isActive: boolean;

  // ============================================================================
  // PROTOCOL-SPECIFIC DATA
  // ============================================================================

  /**
   * Protocol-specific configuration (JSON) - IMMUTABLE
   *
   * Contains immutable position parameters specific to the protocol:
   * - Uniswap V3: chainId, nftId, poolAddress, token0IsQuote, tickUpper, tickLower
   *
   * Type is determined by the protocol parameter P.
   * For Position<'uniswapv3'>, this will be UniswapV3PositionConfig.
   *
   * @see position-config.ts for specific config types
   */
  config: PositionConfigMap[P]['config'];

  /**
   * Protocol-specific state (JSON) - MUTABLE
   *
   * Contains mutable position state that changes over time:
   * - Uniswap V3: ownerAddress, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1
   *
   * Type is determined by the protocol parameter P.
   * For Position<'uniswapv3'>, this will be UniswapV3PositionState.
   *
   * Note: For TypeScript, state uses bigint. In database, bigint values are stored as strings.
   *
   * @see uniswapv3/position-state.ts for specific state types
   */
  state: PositionConfigMap[P]['state'];
}

/**
 * Protocol identifiers for positions
 *
 * Derived from PositionConfigMap keys for type safety.
 */
export type PositionProtocol = keyof PositionConfigMap;

/**
 * Position type identifiers
 *
 * Specifies the liquidity model used by the position:
 * - 'CL_TICKS': Concentrated liquidity with tick-based ranges (Uniswap V3, Orca, etc.)
 * - 'SPOT': Multi-token basket (HODL positions for strategy unallocated assets)
 */
export type PositionType = 'CL_TICKS' | 'SPOT';

// ============================================================================
// TYPE ALIASES FOR SPECIFIC PROTOCOLS
// ============================================================================

/**
 * Uniswap V3 Position
 *
 * Type-safe position with Uniswap V3 configuration and state.
 * Equivalent to Position<'uniswapv3'>.
 */
export type UniswapV3Position = Position<'uniswapv3'>;

/**
 * HODL Position
 *
 * Type-safe position for multi-token baskets.
 * Used by automated strategies to track unallocated assets.
 * Equivalent to Position<'hodl'>.
 */
export type HodlPosition = Position<'hodl'>;

/**
 * Union type for any position
 *
 * Can be a position from any supported protocol.
 */
export type AnyPosition = Position<keyof PositionConfigMap>;

// ============================================================================
// HELPER FUNCTIONS FOR TOKEN ROLE DERIVATION
// ============================================================================

/**
 * Get the base token from a position
 *
 * The base token is the asset being priced (e.g., ETH in ETH/USDC).
 *
 * @param position - The position to get the base token from
 * @returns The base token object
 *
 * @example
 * ```typescript
 * const position: UniswapV3Position = ...;
 * const baseToken = getBaseToken(position);
 * console.log(`Base: ${baseToken.symbol}`); // "WETH"
 * ```
 */
export function getBaseToken<P extends keyof PositionConfigMap>(
  position: Position<P>
): Position<P>['pool']['token0'] {
  return position.isToken0Quote ? position.pool.token1 : position.pool.token0;
}

/**
 * Get the quote token from a position
 *
 * The quote token is the unit of account (e.g., USDC in ETH/USDC).
 *
 * @param position - The position to get the quote token from
 * @returns The quote token object
 *
 * @example
 * ```typescript
 * const position: UniswapV3Position = ...;
 * const quoteToken = getQuoteToken(position);
 * console.log(`Quote: ${quoteToken.symbol}`); // "USDC"
 * ```
 */
export function getQuoteToken<P extends keyof PositionConfigMap>(
  position: Position<P>
): Position<P>['pool']['token0'] {
  return position.isToken0Quote ? position.pool.token0 : position.pool.token1;
}

// ============================================================================
// TYPE GUARDS AND ASSERTIONS
// ============================================================================

/**
 * Type guard for Uniswap V3 positions
 *
 * Safely narrows AnyPosition to UniswapV3Position, allowing access to
 * protocol-specific config and state fields.
 *
 * @param position - Position to check
 * @returns True if position is a Uniswap V3 position
 *
 * @example
 * ```typescript
 * const position: AnyPosition = await getPosition();
 *
 * if (isUniswapV3Position(position)) {
 *   // TypeScript knows position is UniswapV3Position here
 *   console.log(position.config.nftId);
 *   console.log(position.state.liquidity);
 * }
 * ```
 */
export function isUniswapV3Position(
  position: AnyPosition
): position is UniswapV3Position {
  return position.protocol === 'uniswapv3';
}

/**
 * Assertion function for Uniswap V3 positions
 *
 * Throws an error if position is not a Uniswap V3 position.
 * After calling this function, TypeScript knows the position is UniswapV3Position.
 *
 * @param position - Position to check
 * @throws Error if position is not a Uniswap V3 position
 *
 * @example
 * ```typescript
 * const position: AnyPosition = await getPosition();
 *
 * assertUniswapV3Position(position);
 * // TypeScript knows position is UniswapV3Position after this line
 * console.log(position.config.nftId);
 * ```
 */
export function assertUniswapV3Position(
  position: AnyPosition
): asserts position is UniswapV3Position {
  if (!isUniswapV3Position(position)) {
    throw new Error(
      `Expected Uniswap V3 position, got protocol: ${(position as AnyPosition).protocol}`
    );
  }
}

/**
 * Type guard for HODL positions
 *
 * Safely narrows AnyPosition to HodlPosition, allowing access to
 * HODL-specific config and state fields.
 *
 * @param position - Position to check
 * @returns True if position is a HODL position
 *
 * @example
 * ```typescript
 * const position: AnyPosition = await getPosition();
 *
 * if (isHodlPosition(position)) {
 *   // TypeScript knows position is HodlPosition here
 *   console.log(position.state.holdings);
 * }
 * ```
 */
export function isHodlPosition(position: AnyPosition): position is HodlPosition {
  return position.protocol === 'hodl';
}

/**
 * Assertion function for HODL positions
 *
 * Throws an error if position is not a HODL position.
 * After calling this function, TypeScript knows the position is HodlPosition.
 *
 * @param position - Position to check
 * @throws Error if position is not a HODL position
 *
 * @example
 * ```typescript
 * const position: AnyPosition = await getPosition();
 *
 * assertHodlPosition(position);
 * // TypeScript knows position is HodlPosition after this line
 * console.log(position.state.holdings);
 * ```
 */
export function assertHodlPosition(
  position: AnyPosition
): asserts position is HodlPosition {
  if (!isHodlPosition(position)) {
    throw new Error(
      `Expected HODL position, got protocol: ${(position as AnyPosition).protocol}`
    );
  }
}

/**
 * Generic position protocol narrowing function
 *
 * Narrows AnyPosition to a specific protocol type at runtime.
 * Useful when you have a protocol identifier from a variable.
 *
 * @param position - Position to narrow
 * @param protocol - Expected protocol identifier
 * @returns Position narrowed to the specified protocol type
 * @throws Error if position protocol doesn't match expected protocol
 *
 * @example
 * ```typescript
 * const position: AnyPosition = await getPosition();
 * const protocol: 'uniswapv3' = 'uniswapv3';
 *
 * const uniV3Position = narrowPositionProtocol(position, protocol);
 * // TypeScript knows uniV3Position is UniswapV3Position
 * console.log(uniV3Position.config.nftId);
 * ```
 */
export function narrowPositionProtocol<P extends keyof PositionConfigMap>(
  position: AnyPosition,
  protocol: P
): Position<P> {
  if (position.protocol !== protocol) {
    throw new Error(
      `Position protocol mismatch: expected ${protocol}, got ${position.protocol}`
    );
  }
  return position as Position<P>;
}

// ============================================================================
// TOTAL PNL CALCULATION HELPERS
// ============================================================================

/**
 * Calculate total realized PnL including cash flows
 *
 * For complete realized returns, add position PnL and cash flow:
 * - realizedPnl: From DECREASE_LIQUIDITY events (price movement gains/losses)
 * - realizedCashflow: From funding payments, interest, etc. (for non-AMM protocols)
 *
 * For UniswapV3 positions, realizedCashflow is always 0n, so this returns realizedPnl.
 *
 * @param position - Position to calculate total realized PnL for
 * @returns Total realized PnL in quote token units
 *
 * @example
 * ```typescript
 * const position: UniswapV3Position = ...;
 * const totalRealized = getTotalRealizedPnl(position);
 * // For UniswapV3: totalRealized === position.realizedPnl
 *
 * const hyperliquidPosition: HyperliquidPosition = ...;
 * const totalRealized = getTotalRealizedPnl(hyperliquidPosition);
 * // Includes funding payments: realizedPnl + realizedCashflow
 * ```
 */
export function getTotalRealizedPnl<P extends keyof PositionConfigMap>(
  position: Position<P>
): bigint {
  return position.realizedPnl + position.realizedCashflow;
}

/**
 * Calculate total unrealized PnL including cash flows
 *
 * For complete unrealized returns, add position PnL and cash flow:
 * - unrealizedPnl: From current position value vs cost basis
 * - unrealizedCashflow: From accrued funding/interest (for non-AMM protocols)
 *
 * For UniswapV3 positions, unrealizedCashflow is always 0n, so this returns unrealizedPnl.
 *
 * @param position - Position to calculate total unrealized PnL for
 * @returns Total unrealized PnL in quote token units
 *
 * @example
 * ```typescript
 * const position: UniswapV3Position = ...;
 * const totalUnrealized = getTotalUnrealizedPnl(position);
 * // For UniswapV3: totalUnrealized === position.unrealizedPnl
 *
 * const hyperliquidPosition: HyperliquidPosition = ...;
 * const totalUnrealized = getTotalUnrealizedPnl(hyperliquidPosition);
 * // Includes accrued funding: unrealizedPnl + unrealizedCashflow
 * ```
 */
export function getTotalUnrealizedPnl<P extends keyof PositionConfigMap>(
  position: Position<P>
): bigint {
  return position.unrealizedPnl + position.unrealizedCashflow;
}