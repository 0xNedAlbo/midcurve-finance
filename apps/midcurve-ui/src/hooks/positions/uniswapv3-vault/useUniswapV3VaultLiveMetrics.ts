/**
 * useUniswapV3VaultLiveMetrics - Patches live pool price into vault position data
 *
 * Key difference from NFT version: user's liquidity is derived as
 * liquidity * sharesBalance / totalSupply before calculating position value.
 */

import { useMemo } from "react";
import {
  calculatePositionValue,
  valueOfToken0AmountInToken1,
  valueOfToken1AmountInToken0,
} from "@midcurve/shared";
import type { UniswapV3VaultPositionData } from "./useUniswapV3VaultPosition";
import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
  UniswapV3PoolStateResponse,
} from "@midcurve/api-shared";
import { useWatchUniswapV3PoolPrice } from "@/hooks/pools/useWatchUniswapV3PoolPrice";

const POLL_INTERVAL_MS = 5000;

export function useUniswapV3VaultLiveMetrics(
  position: UniswapV3VaultPositionData
): UniswapV3VaultPositionData {
  const config = position.config as UniswapV3VaultPositionConfigResponse;

  const { sqrtPriceX96BigInt, currentTick } = useWatchUniswapV3PoolPrice({
    poolAddress: config.poolAddress,
    chainId: config.chainId,
    enabled: position.isActive,
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  return useMemo(() => {
    if (sqrtPriceX96BigInt == null || sqrtPriceX96BigInt === 0n || currentTick == null) {
      return position;
    }

    const state = position.state as UniswapV3VaultPositionStateResponse;
    const baseIsToken0 = !position.isToken0Quote;

    // Derive user's proportional liquidity
    const totalSupply = BigInt(state.totalSupply);
    const sharesBalance = BigInt(state.sharesBalance);
    const vaultLiquidity = BigInt(state.liquidity);
    const userLiquidity = totalSupply > 0n
      ? (vaultLiquidity * sharesBalance) / totalSupply
      : 0n;

    // Recalculate position value at live price using user's proportional liquidity
    const currentValue = calculatePositionValue(
      userLiquidity,
      sqrtPriceX96BigInt,
      config.tickLower,
      config.tickUpper,
      baseIsToken0
    );

    // Unrealized PnL = currentValue - costBasis
    const unrealizedPnl = currentValue - BigInt(position.costBasis);

    // Unclaimed fees: convert token0/token1 amounts to quote token value at live price
    const unclaimedFees0 = BigInt(state.unclaimedFees0);
    const unclaimedFees1 = BigInt(state.unclaimedFees1);
    let unclaimedYield: bigint;
    if (position.isToken0Quote) {
      unclaimedYield =
        unclaimedFees0 +
        valueOfToken1AmountInToken0(unclaimedFees1, sqrtPriceX96BigInt);
    } else {
      unclaimedYield =
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
      unclaimedYield: unclaimedYield.toString(),
      pool: {
        ...position.pool,
        state: livePoolState,
      },
    };
  }, [position, sqrtPriceX96BigInt, currentTick, config.tickLower, config.tickUpper]);
}
