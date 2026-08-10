"use client";

import { useMemo } from "react";
import { applyCurrentPrice } from "@midcurve/shared";
import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
  UniswapV3PoolStateResponse,
} from "@midcurve/api-shared";
import { ConversionSummary } from "../uniswapv3/conversion-summary";
import { useUniswapV3VaultConversion } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultConversion";

interface UniswapV3VaultConversionTabProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultConversionTab({ position }: UniswapV3VaultConversionTabProps) {
  const config = position.config as UniswapV3VaultPositionConfigResponse;

  const { data: summary, isLoading } = useUniswapV3VaultConversion(
    config.chainId,
    config.vaultAddress,
    config.ownerAddress,
  );

  // Re-apply the pool price the rest of the page is rendering — see the NFT tab
  // for why. The liquidity basis is the holder's proportional share, the same
  // one the Overview tab uses; the route derives it from sharesBalance alone,
  // which only agrees while totalSupply equals the vault's liquidity.
  const pricedSummary = useMemo(() => {
    if (!summary) return null;

    const state = position.state as UniswapV3VaultPositionStateResponse;
    const poolState = position.pool.state as UniswapV3PoolStateResponse;

    const totalSupply = BigInt(state.totalSupply);
    const userLiquidity =
      totalSupply > 0n
        ? (BigInt(state.liquidity) * BigInt(state.sharesBalance)) / totalSupply
        : 0n;

    return applyCurrentPrice(summary, {
      isToken0Quote: position.isToken0Quote,
      tickLower: config.tickLower,
      tickUpper: config.tickUpper,
      sqrtPriceX96: BigInt(poolState.sqrtPriceX96),
      liquidity: userLiquidity,
      unclaimedFees0: BigInt(state.unclaimedFees0),
      unclaimedFees1: BigInt(state.unclaimedFees1),
    });
  }, [summary, position, config.tickLower, config.tickUpper]);

  return <ConversionSummary summary={pricedSummary} isLoading={isLoading} />;
}
