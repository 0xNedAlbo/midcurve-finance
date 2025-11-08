"use client";

import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import { PnLBreakdown } from "@/components/positions/pnl-breakdown";
import { LedgerEventTable } from "@/components/positions/ledger/ledger-event-table";
import { useUniswapV3Ledger } from "@/hooks/positions/uniswapv3/useUniswapV3Ledger";

interface UniswapV3HistoryTabProps {
  position: GetUniswapV3PositionResponse;
}

export function UniswapV3HistoryTab({ position }: UniswapV3HistoryTabProps) {
  // Extract tokens (quote/base determination from position)
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  // Extract config data
  const config = position.config as { chainId: number; nftId: number };

  // Fetch ledger events (returns array directly, not response wrapper)
  const { data: ledgerEvents, isLoading } = useUniswapV3Ledger(
    config.chainId,
    config.nftId.toString()
  );

  return (
    <div className="space-y-8">
      {/* Section 1: PnL Breakdown */}
      <PnLBreakdown
        currentValue={position.currentValue}
        currentCostBasis={position.currentCostBasis}
        collectedFees={position.collectedFees}
        unclaimedFees={position.unClaimedFees}
        realizedPnL={position.realizedPnl}
        quoteTokenSymbol={quoteToken.symbol}
        quoteTokenDecimals={quoteToken.decimals}
      />

      {/* Section 2: Position Ledger */}
      <LedgerEventTable
        events={ledgerEvents ?? []}
        isLoading={isLoading}
        chainId={config.chainId}
        quoteToken={quoteToken}
        token0={position.pool.token0}
        token1={position.pool.token1}
      />
    </div>
  );
}
