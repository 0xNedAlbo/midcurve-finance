/**
 * Position Input Types
 *
 * Input types for Position CRUD operations.
 * These types are NOT shared with UI/API - they're specific to the service layer.
 */

import type {
  PositionProtocol,
  PositionType,
  UniswapV3PositionConfigData,
  UniswapV3PositionState,
} from '@midcurve/shared';

// =============================================================================
// DISCOVERY INPUTS
// =============================================================================

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
   */
  quoteTokenAddress?: string;
}

// =============================================================================
// BASE INPUT INTERFACES
// =============================================================================

/**
 * Base interface for creating any position
 */
interface BaseCreatePositionInput {
  protocol: PositionProtocol;
  positionType: PositionType;
  userId: string;
  poolId: string;
  isToken0Quote: boolean;
  positionOpenedAt?: Date;
}

/**
 * Base interface for updating any position
 * Note: Most position fields are immutable. Use refresh() for state updates.
 */
interface BaseUpdatePositionInput {
  // Currently no mutable fields - positions are updated via refresh()
}

// =============================================================================
// UNISWAP V3 INPUT TYPES
// =============================================================================

/**
 * Input for creating a Uniswap V3 position
 */
export interface CreateUniswapV3PositionInput extends BaseCreatePositionInput {
  protocol: 'uniswapv3';
  positionType: 'CL_TICKS';
  config: UniswapV3PositionConfigData;
  state: UniswapV3PositionState;
}

/**
 * Input for updating a Uniswap V3 position
 */
export interface UpdateUniswapV3PositionInput extends BaseUpdatePositionInput {
  // Currently no mutable fields - positions are updated via refresh()
}

// =============================================================================
// UNION TYPES
// =============================================================================

/**
 * Union type for any position create input
 */
export type CreateAnyPositionInput = CreateUniswapV3PositionInput;

/**
 * Union type for any position update input
 */
export type UpdateAnyPositionInput = UpdateUniswapV3PositionInput;
