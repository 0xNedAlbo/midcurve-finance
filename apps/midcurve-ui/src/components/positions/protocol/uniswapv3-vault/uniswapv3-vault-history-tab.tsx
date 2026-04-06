"use client";

import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type { UniswapV3VaultPositionConfigResponse } from "@midcurve/api-shared";
import { PnLBreakdown } from "@/components/positions/pnl-breakdown";
import { LedgerEventTable } from "@/components/positions/ledger/ledger-event-table";
import { useUniswapV3VaultLedger } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultLedger";

interface UniswapV3VaultHistoryTabProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultHistoryTab({ position }: UniswapV3VaultHistoryTabProps) {
  // Extract tokens (quote/base determination from position)
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  // Extract config data
  const config = position.config as UniswapV3VaultPositionConfigResponse;

  // Fetch ledger events (returns array directly, not response wrapper)
  // Vault event types: VAULT_MINT, VAULT_BURN, VAULT_COLLECT_YIELD, VAULT_TRANSFER_IN, VAULT_TRANSFER_OUT
  const { data: ledgerEvents, isLoading } = useUniswapV3VaultLedger(
    config.chainId,
    config.vaultAddress
  );

  return (
    <div className="space-y-8">
      {/* Section 1: PnL Breakdown */}
      <PnLBreakdown
        currentValue={position.currentValue}
        costBasis={position.costBasis}
        collectedYield={position.collectedYield}
        unclaimedFees={position.unclaimedYield}
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
