"use client";

import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import { OptionalitySummary } from "./optionality-summary";
import { useUniswapV3Ledger } from "@/hooks/positions/uniswapv3/useUniswapV3Ledger";
import { useUniswapV3OptionalitySummary } from "@/hooks/positions/uniswapv3/useUniswapV3OptionalitySummary";

interface UniswapV3OptionalityTabProps {
  position: UniswapV3PositionData;
}

export function UniswapV3OptionalityTab({ position }: UniswapV3OptionalityTabProps) {
  const config = position.config as { chainId: number; nftId: number };

  const { data: ledgerEvents, isLoading } = useUniswapV3Ledger(
    config.chainId,
    config.nftId.toString()
  );

  const summary = useUniswapV3OptionalitySummary(position, ledgerEvents);

  return (
    <OptionalitySummary
      summary={summary}
      isLoading={isLoading}
    />
  );
}
