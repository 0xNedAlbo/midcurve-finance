/**
 * Position Input Types
 *
 * Input types for Position CRUD operations.
 * These types are NOT shared with UI/API - they're specific to the service layer.
 *
 * Uses mapped types to ensure type-safe protocol-specific operations.
 */

import type {
  Position,
  PositionConfigMap,
} from '@midcurve/shared';

/**
 * Uniswap V3 Position Discovery Input
 *
 * Parameters needed to discover a Uniswap V3 position from on-chain data.
 */
export interface UniswapV3PositionDiscoverInput {
  /**
   * Chain ID where the position is deployed
   * Examples: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * NFT token ID representing the position
   * Each Uniswap V3 position is represented by an NFT in the NonfungiblePositionManager contract
   */
  nftId: number;

  /**
   * OPTIONAL: Address of the quote token (the token used as unit of account)
   *
   * If provided:
   * - Will be validated and normalized to EIP-55 checksum format
   * - Must match either token0 or token1 in the pool
   * - Service will use this address to determine isToken0Quote
   *
   * If omitted:
   * - Quote token will be determined automatically using QuoteTokenService
   * - Respects user preferences → chain defaults → token0 fallback
   *
   * @example
   * // For ETH/USDC position with USDC as quote (explicit)
   * quoteTokenAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
   *
   * @example
   * // Auto-detect quote token (recommended for API endpoints)
   * quoteTokenAddress = undefined
   */
  quoteTokenAddress?: string;
}

/**
 * Position Discovery Input Map
 *
 * Maps protocol identifiers to their corresponding discovery input types.
 * Ensures type safety: discover() for protocol 'uniswapv3' requires UniswapV3PositionDiscoverInput.
 *
 * When adding a new protocol:
 * 1. Create the discovery input interface (e.g., OrcaPositionDiscoverInput)
 * 2. Add entry to this mapping
 */
export interface PositionDiscoverInputMap {
  uniswapv3: UniswapV3PositionDiscoverInput;
  // Future protocols:
  // orca: OrcaPositionDiscoverInput;
  // raydium: RaydiumPositionDiscoverInput;
  // pancakeswapv3: PancakeSwapV3PositionDiscoverInput;
}

/**
 * Generic position discovery input type
 * Type-safe based on protocol parameter
 */
export type PositionDiscoverInput<P extends keyof PositionDiscoverInputMap> =
  PositionDiscoverInputMap[P];

/**
 * Union type for any position discovery input
 */
export type AnyPositionDiscoverInput =
  PositionDiscoverInput<keyof PositionDiscoverInputMap>;

/**
 * Input type for creating a new position
 *
 * Omits all calculated fields (which are computed by the service):
 * - currentValue, currentCostBasis, realizedPnl, unrealizedPnl
 * - collectedFees, unClaimedFees, lastFeesCollectedAt
 * - priceRangeLower, priceRangeUpper
 * - positionOpenedAt, positionClosedAt, isActive
 * - pool (replaced with poolId for database FK)
 *
 * Also omits database-generated fields: id, createdAt, updatedAt
 *
 * State is required - typically provided by discover() method from on-chain data.
 *
 * Note: This is primarily used by discover() which handles pool discovery,
 * token role determination, and state fetching from on-chain data.
 *
 * @template P - Protocol key from PositionConfigMap ('uniswapv3', etc.)
 */
export type CreatePositionInput<P extends keyof PositionConfigMap> = Pick<
  Position<P>,
  | 'protocol'
  | 'positionType'
  | 'userId'
  | 'isToken0Quote'
  | 'config'
  | 'state'
> & {
  /** Pool ID for database foreign key (service maps this to full Pool object) */
  poolId: string;
  /**
   * Optional: Actual timestamp when position was opened on blockchain
   * If omitted, will default to current time (discovery time)
   * Should be extracted from first blockchain event for accuracy
   */
  positionOpenedAt?: Date;
};

/**
 * Input type aliases for creating positions
 */
export type CreateUniswapV3PositionInput = CreatePositionInput<'uniswapv3'>;
export type CreateAnyPositionInput = CreatePositionInput<keyof PositionConfigMap>;

/**
 * Input type for updating an existing position
 *
 * All fields are optional (partial update).
 * Calculated fields are omitted (recomputed by service).
 * Immutable fields are omitted: id, userId, pool, isToken0Quote, config, state, createdAt, updatedAt
 *
 * Note: This is a basic helper for rare manual updates.
 * - Config updates are rare (position parameters are immutable on-chain)
 * - State updates should typically use refresh() method
 * - Token roles (isToken0Quote) and pool are immutable - set at discovery
 *
 * Currently, there are no mutable fields that can be updated directly.
 * Most updates should use the refresh() method instead.
 *
 * @template P - Protocol key from PositionConfigMap ('uniswapv3', etc.)
 */
export type UpdatePositionInput<P extends keyof PositionConfigMap> = Partial<
  Pick<Position<P>, never>
>;

/**
 * Input type aliases for updating positions
 */
export type UpdateUniswapV3PositionInput = UpdatePositionInput<'uniswapv3'>;
export type UpdateAnyPositionInput = UpdatePositionInput<keyof PositionConfigMap>;
