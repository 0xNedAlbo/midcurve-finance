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
  UniswapV3VaultPosition,
  UniswapV3VaultPositionState,
  UniswapV3StakingPosition,
  UniswapV3StakingPositionState,
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
  UniswapV3PoolWire,
  Erc20TokenWire,
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
 * Return type is pinned to {@link UniswapV3PoolWire} so consumers can rely on
 * the canonical wire shape (no class methods, bigints as strings).
 *
 * @param pool - UniswapV3Pool from service layer
 * @returns JSON-serializable pool object matching UniswapV3PoolWire
 */
export function serializeUniswapV3Pool(pool: UniswapV3Pool): UniswapV3PoolWire {
  return {
    id: pool.id,
    protocol: 'uniswapv3',
    token0: serializeErc20Token(pool.token0 as Erc20Token),
    token1: serializeErc20Token(pool.token1 as Erc20Token),
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
 * Converts Date fields to ISO strings. No bigint fields in token type.
 * Return type is pinned to {@link Erc20TokenWire} for consistency with
 * `serializeUniswapV3Pool`. The `tokenType` literal is fixed because the
 * input is already narrowed to Erc20Token.
 *
 * @param token - Erc20Token from service layer
 * @returns JSON-serializable token object matching Erc20TokenWire
 */
export function serializeErc20Token(token: Erc20Token): Erc20TokenWire {
  return {
    id: token.id,
    tokenType: 'erc20',
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
    isOwnedByUser: state.isOwnedByUser,
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
    protocol: position.protocol as 'uniswapv3',
    userId: position.userId,
    ownerWallet: null as string | null,

    type: position.type,

    // PnL fields (bigint → string)
    currentValue: position.currentValue.toString(),
    costBasis: position.costBasis.toString(),
    realizedPnl: position.realizedPnl.toString(),
    unrealizedPnl: position.unrealizedPnl.toString(),
    realizedCashflow: position.realizedCashflow.toString(),
    unrealizedCashflow: position.unrealizedCashflow.toString(),

    // Yield fields (bigint → string)
    collectedYield: position.collectedYield.toString(),
    unclaimedYield: position.unclaimedYield.toString(),
    lastYieldClaimedAt: position.lastYieldClaimedAt.toISOString(),
    totalApr: position.totalApr,
    baseApr: position.baseApr ?? null,
    rewardApr: position.rewardApr ?? null,

    // Price range (bigint → string)
    priceRangeLower: position.priceRangeLower.toString(),
    priceRangeUpper: position.priceRangeUpper.toString(),

    // Pool and tokens (nested serialization)
    pool: serializeUniswapV3Pool(position.pool as UniswapV3Pool),

    // Token roles
    isToken0Quote: position.isToken0Quote,

    // Position state
    positionOpenedAt: position.positionOpenedAt.toISOString(),
    archivedAt: position.archivedAt?.toISOString() ?? null,
    isArchived: position.isArchived,

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
// VAULT POSITION SERIALIZATION
// ============================================================================

/**
 * Serialize UniswapV3VaultPositionState for JSON response
 */
export function serializeUniswapV3VaultPositionState(state: UniswapV3VaultPositionState) {
  return {
    sharesBalance: state.sharesBalance.toString(),
    totalSupply: state.totalSupply.toString(),
    liquidity: state.liquidity.toString(),
    unclaimedFees0: state.unclaimedFees0.toString(),
    unclaimedFees1: state.unclaimedFees1.toString(),
    operatorAddress: state.operatorAddress,
    isClosed: state.isClosed,
    isOwnedByUser: state.isOwnedByUser,
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    currentTick: state.currentTick,
    poolLiquidity: state.poolLiquidity.toString(),
    feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
    feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
  };
}

/**
 * Serialize UniswapV3VaultPosition for JSON response
 */
export function serializeUniswapV3VaultPosition(position: UniswapV3VaultPosition) {
  return {
    id: position.id,
    positionHash: position.positionHash,
    protocol: position.protocol as 'uniswapv3-vault',
    ownerWallet: null as string | null,
    userId: position.userId,
    type: position.type,

    // PnL fields (bigint → string)
    currentValue: position.currentValue.toString(),
    costBasis: position.costBasis.toString(),
    realizedPnl: position.realizedPnl.toString(),
    unrealizedPnl: position.unrealizedPnl.toString(),
    realizedCashflow: position.realizedCashflow.toString(),
    unrealizedCashflow: position.unrealizedCashflow.toString(),

    // Yield fields (bigint → string)
    collectedYield: position.collectedYield.toString(),
    unclaimedYield: position.unclaimedYield.toString(),
    lastYieldClaimedAt: position.lastYieldClaimedAt?.toISOString() ?? new Date(0).toISOString(),
    totalApr: position.totalApr,
    baseApr: position.baseApr ?? null,
    rewardApr: position.rewardApr ?? null,

    // Price range (bigint → string)
    priceRangeLower: position.priceRangeLower.toString(),
    priceRangeUpper: position.priceRangeUpper.toString(),

    // Pool and tokens (nested serialization — same underlying pool)
    pool: serializeUniswapV3Pool(position.pool as UniswapV3Pool),

    // Token roles
    isToken0Quote: position.isToken0Quote,

    // Position state
    positionOpenedAt: position.positionOpenedAt.toISOString(),
    archivedAt: position.archivedAt?.toISOString() ?? null,
    isArchived: position.isArchived,

    // Protocol-specific
    config: {
      chainId: position.typedConfig.chainId,
      vaultAddress: position.typedConfig.vaultAddress,
      underlyingTokenId: position.typedConfig.underlyingTokenId,
      factoryAddress: position.typedConfig.factoryAddress,
      ownerAddress: position.typedConfig.ownerAddress,
      poolAddress: position.typedConfig.poolAddress,
      token0Address: position.typedConfig.token0Address,
      token1Address: position.typedConfig.token1Address,
      feeBps: position.typedConfig.feeBps,
      tickSpacing: position.typedConfig.tickSpacing,
      tickLower: position.typedConfig.tickLower,
      tickUpper: position.typedConfig.tickUpper,
      vaultDecimals: position.typedConfig.vaultDecimals,
      isToken0Quote: position.typedConfig.isToken0Quote,
      priceRangeLower: position.typedConfig.priceRangeLower.toString(),
      priceRangeUpper: position.typedConfig.priceRangeUpper.toString(),
    },
    state: serializeUniswapV3VaultPositionState(position.typedState),

    // Timestamps
    createdAt: position.createdAt.toISOString(),
    updatedAt: position.updatedAt.toISOString(),
  };
}

// ============================================================================
// UNISWAPV3 STAKING VAULT POSITION SERIALIZATION
// ============================================================================

/**
 * Serialize UniswapV3StakingPositionState for JSON response.
 */
export function serializeUniswapV3StakingPositionState(state: UniswapV3StakingPositionState) {
  return {
    vaultState: state.vaultState,
    stakedBase: state.stakedBase.toString(),
    stakedQuote: state.stakedQuote.toString(),
    yieldTarget: state.yieldTarget.toString(),
    pendingBps: state.pendingBps,
    unstakeBufferBase: state.unstakeBufferBase.toString(),
    unstakeBufferQuote: state.unstakeBufferQuote.toString(),
    rewardBufferBase: state.rewardBufferBase.toString(),
    rewardBufferQuote: state.rewardBufferQuote.toString(),
    liquidity: state.liquidity.toString(),
    isOwnedByUser: state.isOwnedByUser,
    unclaimedYieldBase: state.unclaimedYieldBase.toString(),
    unclaimedYieldQuote: state.unclaimedYieldQuote.toString(),
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    currentTick: state.currentTick,
    poolLiquidity: state.poolLiquidity.toString(),
    feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
    feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
  };
}

/**
 * Serialize UniswapV3StakingPosition for JSON response.
 *
 * Mirrors `serializeUniswapV3VaultPosition` but uses staking-specific
 * config/state shapes.
 */
export function serializeUniswapV3StakingPosition(position: UniswapV3StakingPosition) {
  return {
    id: position.id,
    positionHash: position.positionHash,
    protocol: position.protocol as 'uniswapv3-staking',
    ownerWallet: null as string | null,
    userId: position.userId,
    type: position.type,

    // PnL fields
    currentValue: position.currentValue.toString(),
    costBasis: position.costBasis.toString(),
    realizedPnl: position.realizedPnl.toString(),
    unrealizedPnl: position.unrealizedPnl.toString(),
    realizedCashflow: position.realizedCashflow.toString(),
    unrealizedCashflow: position.unrealizedCashflow.toString(),

    // Yield fields
    collectedYield: position.collectedYield.toString(),
    unclaimedYield: position.unclaimedYield.toString(),
    lastYieldClaimedAt: position.lastYieldClaimedAt?.toISOString() ?? new Date(0).toISOString(),
    totalApr: position.totalApr,
    baseApr: position.baseApr ?? null,
    rewardApr: position.rewardApr ?? null,

    // Price range
    priceRangeLower: position.priceRangeLower.toString(),
    priceRangeUpper: position.priceRangeUpper.toString(),

    // Pool (same underlying UniswapV3 pool)
    pool: serializeUniswapV3Pool(position.pool as UniswapV3Pool),
    isToken0Quote: position.isToken0Quote,

    // Lifecycle
    positionOpenedAt: position.positionOpenedAt.toISOString(),
    archivedAt: position.archivedAt?.toISOString() ?? null,
    isArchived: position.isArchived,

    // Protocol-specific config
    config: {
      chainId: position.typedConfig.chainId,
      vaultAddress: position.typedConfig.vaultAddress,
      factoryAddress: position.typedConfig.factoryAddress,
      ownerAddress: position.typedConfig.ownerAddress,
      underlyingTokenId: position.typedConfig.underlyingTokenId,
      isToken0Quote: position.typedConfig.isToken0Quote,
      poolAddress: position.typedConfig.poolAddress,
      token0Address: position.typedConfig.token0Address,
      token1Address: position.typedConfig.token1Address,
      feeBps: position.typedConfig.feeBps,
      tickSpacing: position.typedConfig.tickSpacing,
      tickLower: position.typedConfig.tickLower,
      tickUpper: position.typedConfig.tickUpper,
      priceRangeLower: position.typedConfig.priceRangeLower.toString(),
      priceRangeUpper: position.typedConfig.priceRangeUpper.toString(),
    },
    state: serializeUniswapV3StakingPositionState(position.typedState),

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
