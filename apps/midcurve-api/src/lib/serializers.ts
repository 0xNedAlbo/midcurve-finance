/**
 * Serialization Utilities
 *
 * Helper functions to convert domain types from @midcurve/shared to JSON-serializable formats.
 * Primarily handles bigint conversion to strings for JSON compatibility.
 */

import type {
  UniswapV3Pool,
  UniswapV3PoolState,
  UniswapV3Position,
  UniswapV3PositionState,
  Erc20Token,
} from '@midcurve/shared';
import {
  ContractTriggerMode,
  ContractSwapDirection,
} from '@midcurve/shared';

import type {
  SerializedCloseOrder,
  AutomationState,
  SwapDirection,
} from '@midcurve/api-shared';

import type { CloseOrder } from '@midcurve/database';

// ============================================================================
// GENERIC SERIALIZATION HELPERS
// ============================================================================

/**
 * Type helper for serialized values
 * Represents a value that has been recursively serialized (bigint → string, Date → string)
 */
type SerializedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SerializedValue[]
  | { [key: string]: SerializedValue };

/**
 * Recursively convert bigint to string for JSON serialization
 *
 * This is a generic helper that works with any object structure.
 * It recursively walks through objects, arrays, and nested structures
 * to convert all bigint values to strings while preserving the rest of the data.
 *
 * Use this when you need to serialize complex nested structures or when
 * you don't want to write a specific serializer function.
 *
 * @param obj - Any value (object, array, primitive, bigint, Date, etc.)
 * @returns The same structure with all bigints converted to strings and Dates to ISO strings
 *
 * @example
 * const position = await positionService.discover(userId, { chainId, nftId });
 * const serialized = serializeBigInt(position);
 * return NextResponse.json(serialized);
 */
export function serializeBigInt<T>(obj: T): SerializedValue {
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }
  if (obj !== null && typeof obj === 'object') {
    const serialized: { [key: string]: SerializedValue } = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeBigInt(value);
    }
    return serialized;
  }
  return obj as SerializedValue;
}

// ============================================================================
// POOL SERIALIZATION
// ============================================================================

/**
 * Serialize UniswapV3Pool for JSON response
 *
 * Converts all bigint fields in pool state to strings for JSON compatibility.
 *
 * @param pool - UniswapV3Pool from service layer
 * @returns JSON-serializable pool object
 */
export function serializeUniswapV3Pool(pool: UniswapV3Pool) {
  return {
    id: pool.id,
    protocol: pool.protocol,
    poolType: pool.poolType,
    token0: serializeErc20Token(pool.token0),
    token1: serializeErc20Token(pool.token1),
    feeBps: pool.feeBps,
    config: {
      chainId: pool.typedConfig.chainId,
      address: pool.typedConfig.address,
      token0: pool.typedConfig.token0,
      token1: pool.typedConfig.token1,
      feeBps: pool.typedConfig.feeBps,
      tickSpacing: pool.typedConfig.tickSpacing,
    },
    state: serializeUniswapV3PoolState(pool.typedState),
    createdAt: pool.createdAt.toISOString(),
    updatedAt: pool.updatedAt.toISOString(),
  };
}

/**
 * Serialize UniswapV3PoolState for JSON response
 *
 * Converts bigint fields (sqrtPriceX96, liquidity, feeGrowth) to strings.
 *
 * @param state - Pool state with bigint fields
 * @returns JSON-serializable state object
 */
export function serializeUniswapV3PoolState(state: UniswapV3PoolState) {
  return {
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    liquidity: state.liquidity.toString(),
    currentTick: state.currentTick,
    feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
    feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
  };
}

/**
 * Serialize Erc20Token for JSON response
 *
 * Converts Date fields to ISO strings.
 * No bigint fields in token type.
 *
 * @param token - Erc20Token from service layer
 * @returns JSON-serializable token object
 */
export function serializeErc20Token(token: Erc20Token) {
  return {
    id: token.id,
    tokenType: token.tokenType,
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    logoUrl: token.logoUrl,
    coingeckoId: token.coingeckoId,
    marketCap: token.marketCap,
    config: {
      address: token.typedConfig.address,
      chainId: token.typedConfig.chainId,
    },
    createdAt: token.createdAt.toISOString(),
    updatedAt: token.updatedAt.toISOString(),
  };
}

// ============================================================================
// POSITION SERIALIZATION
// ============================================================================

/**
 * Serialize UniswapV3PositionState for JSON response
 *
 * Converts bigint fields (liquidity, feeGrowth, tokensOwed) to strings.
 *
 * @param state - Position state with bigint fields
 * @returns JSON-serializable state object
 */
export function serializeUniswapV3PositionState(state: UniswapV3PositionState) {
  return {
    ownerAddress: state.ownerAddress,
    liquidity: state.liquidity.toString(),
    feeGrowthInside0LastX128: state.feeGrowthInside0LastX128.toString(),
    feeGrowthInside1LastX128: state.feeGrowthInside1LastX128.toString(),
    tokensOwed0: state.tokensOwed0.toString(),
    tokensOwed1: state.tokensOwed1.toString(),
    unclaimedFees0: state.unclaimedFees0.toString(),
    unclaimedFees1: state.unclaimedFees1.toString(),
    isClosed: state.isClosed,
    isBurned: state.isBurned,
  };
}

/**
 * Serialize UniswapV3Position for JSON response
 *
 * Converts all bigint fields to strings for JSON compatibility.
 * Handles nested pool and token objects.
 *
 * Note: For simpler use cases, you can use the generic serializeBigInt() function
 * instead of this specific serializer.
 *
 * @param position - UniswapV3Position from service layer
 * @returns JSON-serializable position object
 */
export function serializeUniswapV3Position(position: UniswapV3Position) {
  return {
    id: position.id,
    positionHash: position.positionHash,
    protocol: position.protocol,
    positionType: position.positionType,
    userId: position.userId,

    // PnL fields (bigint → string)
    currentValue: position.currentValue.toString(),
    currentCostBasis: position.currentCostBasis.toString(),
    realizedPnl: position.realizedPnl.toString(),
    unrealizedPnl: position.unrealizedPnl.toString(),
    realizedCashflow: position.realizedCashflow.toString(),
    unrealizedCashflow: position.unrealizedCashflow.toString(),

    // Fee fields (bigint → string)
    collectedFees: position.collectedFees.toString(),
    unClaimedFees: position.unClaimedFees.toString(),
    lastFeesCollectedAt: position.lastFeesCollectedAt.toISOString(),
    totalApr: position.totalApr,

    // Price range (bigint → string)
    priceRangeLower: position.priceRangeLower.toString(),
    priceRangeUpper: position.priceRangeUpper.toString(),

    // Pool and tokens (nested serialization)
    pool: serializeUniswapV3Pool(position.pool),

    // Token roles
    isToken0Quote: position.isToken0Quote,

    // Position state
    positionOpenedAt: position.positionOpenedAt.toISOString(),
    positionClosedAt: position.positionClosedAt?.toISOString() ?? null,
    isActive: position.isActive,

    // Protocol-specific (config has no bigints, state has bigints)
    config: {
      chainId: position.typedConfig.chainId,
      nftId: position.typedConfig.nftId,
      poolAddress: position.typedConfig.poolAddress,
      tickUpper: position.typedConfig.tickUpper,
      tickLower: position.typedConfig.tickLower,
    },
    state: serializeUniswapV3PositionState(position.typedState),

    // Timestamps
    createdAt: position.createdAt.toISOString(),
    updatedAt: position.updatedAt.toISOString(),
  };
}

// ============================================================================
// AUTOMATION SERIALIZATION
// ============================================================================

/**
 * Map contract SwapDirection integer to API SwapDirection string (or null for NONE).
 */
function mapSwapDirection(swapDirection: number): SwapDirection | null {
  if (swapDirection === ContractSwapDirection.TOKEN0_TO_1) return 'TOKEN0_TO_1';
  if (swapDirection === ContractSwapDirection.TOKEN1_TO_0) return 'TOKEN1_TO_0';
  return null;
}

/**
 * Serialize CloseOrder (Prisma model) for JSON response.
 *
 * Extracts protocol-specific fields from JSON config/state columns.
 * Currently only supports 'uniswapv3' protocol for backward compatibility
 * with UI components.
 */
export function serializeCloseOrder(
  order: CloseOrder
): SerializedCloseOrder {
  const config = (order.config ?? {}) as Record<string, unknown>;
  const state = (order.state ?? {}) as Record<string, unknown>;

  return {
    id: order.id,
    protocol: order.protocol,
    closeOrderHash: order.closeOrderHash,
    closeOrderType: 'uniswapv3',

    // Lifecycle state (single field, no derivation needed)
    automationState: order.automationState as AutomationState,
    executionAttempts: order.executionAttempts,
    lastError: order.lastError,

    // Identity fields (from config JSON)
    positionId: order.positionId,
    chainId: (config.chainId as number) ?? 0,
    nftId: (config.nftId as string) ?? '',
    triggerMode: (config.triggerMode as number) === ContractTriggerMode.LOWER ? 'LOWER' : 'UPPER',

    // On-chain state (from state JSON)
    triggerTick: (state.triggerTick as number | null) ?? null,
    slippageBps: (state.slippageBps as number | null) ?? null,

    // Swap config (from state JSON)
    swapDirection: mapSwapDirection((state.swapDirection as number) ?? 0),
    swapSlippageBps: (state.swapSlippageBps as number | null) ?? null,

    // Additional fields (from config + state JSON)
    validUntil: (state.validUntil as string | null) ?? null,
    payoutAddress: (state.payoutAddress as string | null) ?? null,
    contractAddress: (config.contractAddress as string) ?? '',
    operatorAddress: (state.operatorAddress as string | null) ?? null,

    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
