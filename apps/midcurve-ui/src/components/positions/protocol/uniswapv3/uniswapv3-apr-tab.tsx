"use client";

import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import { AprBreakdown } from "@/components/positions/apr-breakdown";
import { AprPeriodsTable } from "@/components/positions/apr-periods-table";
import { useUniswapV3AprPeriods } from "@/hooks/positions/uniswapv3/useUniswapV3AprPeriods";

interface UniswapV3AprTabProps {
  position: GetUniswapV3PositionResponse;
}

export function UniswapV3AprTab({ position }: UniswapV3AprTabProps) {
  // Extract tokens (quote/base determination from position)
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  // Extract config data
  const config = position.config as { chainId: number; nftId: number };

  // Fetch APR periods (returns array directly, not response wrapper)
  const { data: aprPeriods, isLoading } = useUniswapV3AprPeriods(
    config.chainId,
    config.nftId.toString()
  );

  return (
    <div className="space-y-8">
      {/* Section 1: APR Breakdown */}
      <AprBreakdown
        periods={aprPeriods ?? []}
        currentCostBasis={position.currentCostBasis}
        unclaimedFees={position.unClaimedFees}
        quoteTokenSymbol={quoteToken.symbol}
        quoteTokenDecimals={quoteToken.decimals}
      />

      {/* Section 2: APR Periods Table */}
      <AprPeriodsTable
        periods={aprPeriods ?? []}
        quoteTokenSymbol={quoteToken.symbol}
        quoteTokenDecimals={quoteToken.decimals}
        isLoading={isLoading}
      />
    </div>
  );
}
