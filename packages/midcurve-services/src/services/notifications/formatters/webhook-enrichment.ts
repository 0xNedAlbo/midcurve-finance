/**
 * Webhook Enrichment Helpers
 *
 * Formatting and serialization functions for building rich webhook payloads.
 * Migrated from notification-worker.ts — these convert raw on-chain data
 * into human-readable format for webhook consumers.
 */

import type { OnChainCloseOrder } from '@midcurve/database';
import type { UniswapV3Position, UniswapV3Pool } from '@midcurve/shared';
import {
  formatCompactValue,
  tickToSqrtRatioX96,
  sqrtRatioX96ToToken1PerToken0,
  sqrtRatioX96ToToken0PerToken1,
  getQuoteToken,
  getBaseToken,
} from '@midcurve/shared';
import JSBI from 'jsbi';

// =============================================================================
// PRICE FORMATTING
// =============================================================================

/**
 * Convert sqrtPriceX96 to human-readable price string.
 * Price is expressed in quote token per base token.
 */
export function formatSqrtPriceX96(
  sqrtPriceX96: string | JSBI,
  decimals0: number,
  decimals1: number,
  quoteIsToken0: boolean
): string {
  const sqrtJSBI = typeof sqrtPriceX96 === 'string' ? JSBI.BigInt(sqrtPriceX96) : sqrtPriceX96;

  const priceRaw = quoteIsToken0
    ? sqrtRatioX96ToToken0PerToken1(sqrtJSBI, decimals1)
    : sqrtRatioX96ToToken1PerToken0(sqrtJSBI, decimals0);

  const quoteDecimals = quoteIsToken0 ? decimals0 : decimals1;
  return formatCompactValue(priceRaw, quoteDecimals);
}

/**
 * Convert tick to human-readable price string.
 */
export function formatTickAsPrice(
  tick: number,
  decimals0: number,
  decimals1: number,
  quoteIsToken0: boolean
): string {
  const sqrtPriceX96 = tickToSqrtRatioX96(tick);
  return formatSqrtPriceX96(sqrtPriceX96, decimals0, decimals1, quoteIsToken0);
}

/**
 * Format a bigint amount with token decimals.
 */
export function formatAmount(amount: bigint, decimals: number): string {
  return formatCompactValue(amount, decimals);
}

// =============================================================================
// SERIALIZATION
// =============================================================================

/**
 * Serialize a position for webhook payload (convert bigints to strings).
 */
export function serializePositionForWebhook(position: UniswapV3Position): Record<string, unknown> {
  const pool = position.pool as UniswapV3Pool;
  const quoteToken = getQuoteToken(position);
  const baseToken = getBaseToken(position);

  return {
    id: position.id,
    positionHash: position.positionHash,
    protocol: position.protocol,
    positionType: position.positionType,
    isActive: position.isActive,
    currentValue: position.currentValue.toString(),
    currentCostBasis: position.currentCostBasis.toString(),
    realizedPnl: position.realizedPnl.toString(),
    unrealizedPnl: position.unrealizedPnl.toString(),
    unClaimedFees: position.unClaimedFees.toString(),
    collectedFees: position.collectedFees.toString(),
    totalApr: position.totalApr,
    positionOpenedAt: position.positionOpenedAt?.toISOString() ?? null,
    lastFeesCollectedAt: position.lastFeesCollectedAt?.toISOString() ?? null,
    pool: {
      id: pool.id,
      poolType: pool.poolType,
      token0: {
        id: pool.token0.id,
        symbol: pool.token0.symbol,
        name: pool.token0.name,
        decimals: pool.token0.decimals,
      },
      token1: {
        id: pool.token1.id,
        symbol: pool.token1.symbol,
        name: pool.token1.name,
        decimals: pool.token1.decimals,
      },
      quoteToken: {
        id: quoteToken.id,
        symbol: quoteToken.symbol,
        name: quoteToken.name,
        decimals: quoteToken.decimals,
      },
      baseToken: {
        id: baseToken.id,
        symbol: baseToken.symbol,
        name: baseToken.name,
        decimals: baseToken.decimals,
      },
      isToken0Quote: position.isToken0Quote,
      config: pool.config,
    },
    config: {
      chainId: position.typedConfig.chainId,
      nftId: position.typedConfig.nftId.toString(),
      tickLower: position.typedConfig.tickLower,
      tickUpper: position.typedConfig.tickUpper,
    },
    state: {
      ownerAddress: position.typedState.ownerAddress,
      liquidity: position.typedState.liquidity.toString(),
      feeGrowthInside0LastX128: position.typedState.feeGrowthInside0LastX128.toString(),
      feeGrowthInside1LastX128: position.typedState.feeGrowthInside1LastX128.toString(),
      tokensOwed0: position.typedState.tokensOwed0.toString(),
      tokensOwed1: position.typedState.tokensOwed1.toString(),
    },
    createdAt: position.createdAt.toISOString(),
    updatedAt: position.updatedAt.toISOString(),
  };
}

/**
 * Serialize an on-chain close order for webhook payload.
 */
export function serializeCloseOrderForWebhook(order: OnChainCloseOrder): Record<string, unknown> {
  return {
    id: order.id,
    closeOrderHash: order.closeOrderHash,
    chainId: order.chainId,
    nftId: order.nftId,
    triggerMode: order.triggerMode,
    triggerTick: order.triggerTick,
    onChainStatus: order.onChainStatus,
    monitoringState: order.monitoringState,
    contractAddress: order.contractAddress,
    operatorAddress: order.operatorAddress,
    slippageBps: order.slippageBps,
    swapDirection: order.swapDirection,
    swapSlippageBps: order.swapSlippageBps,
    payoutAddress: order.payoutAddress,
    positionId: order.positionId,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
