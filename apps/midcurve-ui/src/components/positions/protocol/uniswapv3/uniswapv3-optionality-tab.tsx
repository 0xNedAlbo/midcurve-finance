"use client";

import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import { OptionalitySummary } from "./optionality-summary";
import { useUniswapV3Optionality } from "@/hooks/positions/uniswapv3/useUniswapV3Optionality";

interface UniswapV3OptionalityTabProps {
  position: UniswapV3PositionData;
}

export function UniswapV3OptionalityTab({ position }: UniswapV3OptionalityTabProps) {
  const config = position.config as { chainId: number; nftId: number };

  const { data, isLoading } = useUniswapV3Optionality(
    config.chainId,
    config.nftId.toString()
  );

  return (
    <OptionalitySummary
      summary={data}
      isLoading={isLoading}
    />
  );
}
