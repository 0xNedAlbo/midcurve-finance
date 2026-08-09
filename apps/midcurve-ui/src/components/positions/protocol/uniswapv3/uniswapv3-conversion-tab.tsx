"use client";

import { useMemo } from "react";
import { applyCurrentPrice } from "@midcurve/shared";
import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import type {
  UniswapV3PositionConfigResponse,
  UniswapV3PositionStateResponse,
  UniswapV3PoolStateResponse,
} from "@midcurve/api-shared";
import { ConversionSummary } from "./conversion-summary";
import { useUniswapV3Conversion } from "@/hooks/positions/uniswapv3/useUniswapV3Conversion";

interface UniswapV3ConversionTabProps {
  position: UniswapV3PositionData;
}

export function UniswapV3ConversionTab({ position }: UniswapV3ConversionTabProps) {
  const config = position.config as UniswapV3PositionConfigResponse;

  const { data: summary, isLoading } = useUniswapV3Conversion(
    config.chainId,
    config.nftId.toString(),
  );

  // The server computed the summary against the pool price it read at request
  // time; this tab's query holds that response for 60s while the page keeps
  // watching the pool. Re-apply the price the rest of the page is rendering, so
  // "Current Holdings" cannot disagree with the Overview tab's "Current State".
  // Everything else in the summary is a replay of immutable history.
  const pricedSummary = useMemo(() => {
    if (!summary) return null;

    const state = position.state as UniswapV3PositionStateResponse;
    const poolState = position.pool.state as UniswapV3PoolStateResponse;

    return applyCurrentPrice(summary, {
      isToken0Quote: position.isToken0Quote,
      tickLower: config.tickLower,
      tickUpper: config.tickUpper,
      sqrtPriceX96: BigInt(poolState.sqrtPriceX96),
      liquidity: BigInt(state.liquidity),
      unclaimedFees0: BigInt(state.unclaimedFees0),
      unclaimedFees1: BigInt(state.unclaimedFees1),
    });
  }, [summary, position, config.tickLower, config.tickUpper]);

  return <ConversionSummary summary={pricedSummary} isLoading={isLoading} />;
}
