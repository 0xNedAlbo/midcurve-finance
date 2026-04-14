"use client";

import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type { UniswapV3VaultPositionConfigResponse } from "@midcurve/api-shared";
import { AprBreakdown } from "@/components/positions/apr-breakdown";
import { AprPeriodsTable } from "@/components/positions/apr-periods-table";
import { useUniswapV3VaultAprPeriods } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultAprPeriods";

interface UniswapV3VaultAprTabProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultAprTab({ position }: UniswapV3VaultAprTabProps) {
  // Extract tokens (quote/base determination from position)
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  // Extract config data
  const config = position.config as UniswapV3VaultPositionConfigResponse;

  // Fetch APR periods and summary from enhanced endpoint
  const { data: aprResponse, isLoading } = useUniswapV3VaultAprPeriods(
    config.chainId,
    config.vaultAddress,
    config.ownerAddress
  );

  return (
    <div className="space-y-8">
      {/* Section 1: APR Breakdown - uses pre-calculated summary */}
      <AprBreakdown
        summary={aprResponse?.summary ?? {
          realizedFees: "0",
          realizedTWCostBasis: "0",
          realizedActiveDays: 0,
          realizedApr: 0,
          unrealizedFees: "0",
          unrealizedCostBasis: "0",
          unrealizedActiveDays: 0,
          unrealizedApr: 0,
          baseApr: 0,
          rewardApr: 0,
          totalApr: 0,
          totalActiveDays: 0,
          belowThreshold: true,
        }}
        quoteTokenSymbol={quoteToken.symbol}
        quoteTokenDecimals={quoteToken.decimals}
      />

      {/* Section 2: APR Periods Table */}
      <AprPeriodsTable
        periods={aprResponse?.data ?? []}
        quoteTokenSymbol={quoteToken.symbol}
        quoteTokenDecimals={quoteToken.decimals}
        isLoading={isLoading}
      />
    </div>
  );
}
