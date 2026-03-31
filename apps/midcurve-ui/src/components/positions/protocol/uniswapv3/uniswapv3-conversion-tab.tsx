"use client";

import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import { ConversionSummary } from "./conversion-summary";
import { useUniswapV3Ledger } from "@/hooks/positions/uniswapv3/useUniswapV3Ledger";
import { useUniswapV3ConversionSummary } from "@/hooks/positions/uniswapv3/useUniswapV3ConversionSummary";

interface UniswapV3ConversionTabProps {
  position: UniswapV3PositionData;
}

export function UniswapV3ConversionTab({ position }: UniswapV3ConversionTabProps) {
  const config = position.config as { chainId: number; nftId: number };

  const { data: ledgerEvents, isLoading } = useUniswapV3Ledger(
    config.chainId,
    config.nftId.toString()
  );

  const summary = useUniswapV3ConversionSummary(position, ledgerEvents);

  return (
    <ConversionSummary
      summary={summary}
      isLoading={isLoading}
    />
  );
}
