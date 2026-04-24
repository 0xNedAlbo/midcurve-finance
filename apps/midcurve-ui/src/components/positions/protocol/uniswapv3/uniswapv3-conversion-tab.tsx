"use client";

import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import { ConversionSummary } from "./conversion-summary";
import { useUniswapV3Conversion } from "@/hooks/positions/uniswapv3/useUniswapV3Conversion";

interface UniswapV3ConversionTabProps {
  position: UniswapV3PositionData;
}

export function UniswapV3ConversionTab({ position }: UniswapV3ConversionTabProps) {
  const config = position.config as { chainId: number; nftId: number };

  const { data: summary, isLoading } = useUniswapV3Conversion(
    config.chainId,
    config.nftId.toString(),
  );

  return <ConversionSummary summary={summary ?? null} isLoading={isLoading} />;
}
