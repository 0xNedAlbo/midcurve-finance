/**
 * Uniswap V3 Position Ledger Event State Types
 *
 * Raw event data from the blockchain (log data, event parameters, etc.).
 * State is a union type representing different event types from the NFT Position Manager.
 *
 * Purpose:
 * - Store raw blockchain event data for auditability
 * - Enable event replay and recalculation
 * - Provide source data for future analytics
 */

/**
 * Uniswap V3 IncreaseLiquidity Event
 *
 * Emitted when liquidity is added to a position.
 * Raw event data from NFT Position Manager contract.
 *
 * Event Signature:
 * IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
 */
export interface UniswapV3IncreaseLiquidityEvent {
  /**
   * Event type discriminator
   */
  eventType: 'INCREASE_LIQUIDITY';

  /**
   * NFT token ID (indexed parameter, topic[1])
   */
  tokenId: bigint;

  /**
   * Amount of liquidity added
   * From log data (first 32-byte chunk)
   */
  liquidity: bigint;

  /**
   * Amount of token0 deposited
   * From log data (second 32-byte chunk)
   * In smallest token units (e.g., wei for WETH)
   */
  amount0: bigint;

  /**
   * Amount of token1 deposited
   * From log data (third 32-byte chunk)
   * In smallest token units
   */
  amount1: bigint;
}

/**
 * Uniswap V3 DecreaseLiquidity Event
 *
 * Emitted when liquidity is removed from a position.
 * Raw event data from NFT Position Manager contract.
 *
 * Event Signature:
 * DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
 */
export interface UniswapV3DecreaseLiquidityEvent {
  /**
   * Event type discriminator
   */
  eventType: 'DECREASE_LIQUIDITY';

  /**
   * NFT token ID (indexed parameter, topic[1])
   */
  tokenId: bigint;

  /**
   * Amount of liquidity removed
   * From log data (first 32-byte chunk)
   */
  liquidity: bigint;

  /**
   * Amount of token0 removed from position
   * From log data (second 32-byte chunk)
   * In smallest token units
   *
   * Note: This amount is added to "uncollected principal" and must be
   * collected via a separate Collect transaction. It's not immediately
   * transferred to the user.
   */
  amount0: bigint;

  /**
   * Amount of token1 removed from position
   * From log data (third 32-byte chunk)
   * In smallest token units
   *
   * Note: Same as amount0, added to uncollected principal.
   */
  amount1: bigint;
}

/**
 * Uniswap V3 Collect Event
 *
 * Emitted when tokens (fees + principal) are collected from a position.
 * Raw event data from NFT Position Manager contract.
 *
 * Event Signature:
 * Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)
 *
 * Important: This event collects BOTH:
 * - Uncollected principal (from previous DecreaseLiquidity)
 * - Accrued fees
 *
 * The ledger service separates these using uncollectedPrincipal tracking:
 * - Principal collected = min(amount, uncollectedPrincipal)
 * - Fees collected = amount - principal collected
 */
export interface UniswapV3CollectEvent {
  /**
   * Event type discriminator
   */
  eventType: 'COLLECT';

  /**
   * NFT token ID (indexed parameter, topic[1])
   */
  tokenId: bigint;

  /**
   * Recipient address
   * From log data (first 32-byte chunk, last 20 bytes)
   * Address where tokens were sent
   */
  recipient: string;

  /**
   * Amount of token0 collected
   * From log data (second 32-byte chunk)
   * In smallest token units
   *
   * Includes both principal and fees.
   * Service layer separates these using uncollectedPrincipal tracking.
   */
  amount0: bigint;

  /**
   * Amount of token1 collected
   * From log data (third 32-byte chunk)
   * In smallest token units
   *
   * Includes both principal and fees.
   */
  amount1: bigint;
}

/**
 * Uniswap V3 Position Ledger Event State
 *
 * Union type representing any of the three event types.
 * Discriminated by `eventType` field for type narrowing.
 *
 * @example
 * ```typescript
 * function processEvent(state: UniswapV3LedgerEventState) {
 *   if (state.eventType === 'INCREASE_LIQUIDITY') {
 *     // TypeScript knows state is UniswapV3IncreaseLiquidityEvent
 *     console.log(`Added liquidity: ${state.liquidity}`);
 *   } else if (state.eventType === 'DECREASE_LIQUIDITY') {
 *     // TypeScript knows state is UniswapV3DecreaseLiquidityEvent
 *     console.log(`Removed liquidity: ${state.liquidity}`);
 *   } else {
 *     // TypeScript knows state is UniswapV3CollectEvent
 *     console.log(`Collected to: ${state.recipient}`);
 *   }
 * }
 * ```
 */
export type UniswapV3LedgerEventState =
  | UniswapV3IncreaseLiquidityEvent
  | UniswapV3DecreaseLiquidityEvent
  | UniswapV3CollectEvent;
