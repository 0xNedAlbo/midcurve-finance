/**
 * useUniswapV3LiveMetrics - Patches live pool price into position data
 *
 * Polls the pool price every 5 seconds via the pool price watcher subscription
 * and recalculates price-dependent metrics (currentValue, unrealizedPnl,
 * unClaimedFees) client-side. Returns a fully populated position structure
 * so all child components automatically reflect the live price.
 *
 * Works alongside:
 * - useUniswapV3AutoRefresh (60s) — on-chain sync for fees, APR, liquidity
 * - useUniswapV3Position (3s) — DB polling for background state changes
 */

import { useMemo } from "react";
import {
  calculatePositionValue,
  valueOfToken0AmountInToken1,
  valueOfToken1AmountInToken0,
} from "@midcurve/shared";
import type { UniswapV3PositionData } from "./useUniswapV3Position";
import type {
  UniswapV3PositionConfigResponse,
  UniswapV3PositionStateResponse,
  UniswapV3PoolStateResponse,
} from "@midcurve/api-shared";
import { useWatchUniswapV3PoolPrice } from "@/hooks/pools/useWatchUniswapV3PoolPrice";

const POLL_INTERVAL_MS = 5000;

export function useUniswapV3LiveMetrics(
  position: UniswapV3PositionData
): UniswapV3PositionData {
  const config = position.config as UniswapV3PositionConfigResponse;

  const { sqrtPriceX96BigInt, currentTick } = useWatchUniswapV3PoolPrice({
    poolAddress: config.poolAddress,
    chainId: config.chainId,
    enabled: position.isActive,
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  return useMemo(() => {
    if (sqrtPriceX96BigInt == null || currentTick == null) {
      return position;
    }

    const state = position.state as UniswapV3PositionStateResponse;
    const liquidity = BigInt(state.liquidity);
    const baseIsToken0 = !position.isToken0Quote;

    // Recalculate position value at live price
    const currentValue = calculatePositionValue(
      liquidity,
      sqrtPriceX96BigInt,
      config.tickLower,
      config.tickUpper,
      baseIsToken0
    );

    // Unrealized PnL = currentValue - costBasis
    const unrealizedPnl = currentValue - BigInt(position.currentCostBasis);

    // Unclaimed fees: convert token0/token1 amounts to quote token value at live price
    const unclaimedFees0 = BigInt(state.unclaimedFees0);
    const unclaimedFees1 = BigInt(state.unclaimedFees1);
    let unClaimedFees: bigint;
    if (position.isToken0Quote) {
      unClaimedFees =
        unclaimedFees0 +
        valueOfToken1AmountInToken0(unclaimedFees1, sqrtPriceX96BigInt);
    } else {
      unClaimedFees =
        unclaimedFees1 +
        valueOfToken0AmountInToken1(unclaimedFees0, sqrtPriceX96BigInt);
    }

    // Patch live values into position structure
    const livePoolState: UniswapV3PoolStateResponse = {
      ...(position.pool.state as UniswapV3PoolStateResponse),
      sqrtPriceX96: sqrtPriceX96BigInt.toString(),
      currentTick,
    };

    return {
      ...position,
      currentValue: currentValue.toString(),
      unrealizedPnl: unrealizedPnl.toString(),
      unClaimedFees: unClaimedFees.toString(),
      pool: {
        ...position.pool,
        state: livePoolState,
      },
    };
  }, [position, sqrtPriceX96BigInt, currentTick, config.tickLower, config.tickUpper]);
}
