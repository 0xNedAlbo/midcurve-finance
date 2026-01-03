"use client";

/**
 * UniswapV3 Automation Tab
 *
 * Displays automation features for a Uniswap V3 position:
 * - Close order management (stop-loss, take-profit)
 * - Order history
 */

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { Address } from "viem";
import { formatCompactValue } from "@/lib/fraction-format";
import { calculatePositionStates } from "@/lib/position-states";
import { useSharedContract } from "@/hooks/automation";
import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import { PositionCloseOrdersPanel, CloseOrderModal } from "../../automation";

interface UniswapV3AutomationTabProps {
  position: GetUniswapV3PositionResponse;
}

export function UniswapV3AutomationTab({ position }: UniswapV3AutomationTabProps) {
  // Close order modal state
  const [isCloseOrderModalOpen, setIsCloseOrderModalOpen] = useState(false);

  // Get quote token info for formatting
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;

  // Extract pool and position config for automation
  const poolConfig = position.pool.config as { address: string; chainId: number };
  const poolState = position.pool.state as { sqrtPriceX96: string };
  const positionConfig = position.config as { nftId: number };
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  // Get shared automation contract for this chain
  const {
    data: contractData,
    isLoading: isContractLoading,
    error: contractError,
  } = useSharedContract(poolConfig.chainId);

  const contractAddress = contractData?.contractAddress as Address | undefined;
  const positionManager = contractData?.positionManager as Address | undefined;
  const isChainSupported = contractData?.isSupported ?? false;

  // PnL breakdown data for position states calculation
  const pnlBreakdown = {
    currentValue: position.currentValue,
    currentCostBasis: position.currentCostBasis,
    realizedPnL: position.realizedPnl,
    collectedFees: position.collectedFees,
    unclaimedFees: position.unClaimedFees,
  };

  // Calculate position states (for current pool price)
  const positionStates = calculatePositionStates(position, pnlBreakdown);

  // Loading state while fetching contract
  if (isContractLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  // Error state if contract fetch failed
  if (contractError) {
    return (
      <div className="flex items-center gap-2 py-4 text-red-400">
        <AlertCircle className="w-5 h-5" />
        <span>Failed to load automation contract</span>
      </div>
    );
  }

  // Chain not supported for automation
  if (!isChainSupported) {
    return (
      <div className="flex items-center gap-2 py-4 text-amber-400">
        <AlertCircle className="w-5 h-5" />
        <span>Automation is not yet available on this chain</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Close Orders Panel */}
      <PositionCloseOrdersPanel
        positionId={position.id}
        chainId={poolConfig.chainId}
        contractAddress={contractAddress}
        quoteTokenSymbol={quoteToken.symbol}
        quoteTokenDecimals={quoteToken.decimals}
        baseTokenSymbol={baseToken.symbol}
        baseTokenDecimals={baseToken.decimals}
        onCreateOrder={() => setIsCloseOrderModalOpen(true)}
      />

      {/* Close Order Modal */}
      <CloseOrderModal
        isOpen={isCloseOrderModalOpen}
        onClose={() => setIsCloseOrderModalOpen(false)}
        positionId={position.id}
        poolAddress={poolConfig.address}
        chainId={poolConfig.chainId}
        contractAddress={contractAddress!}
        positionManager={positionManager!}
        nftId={BigInt(positionConfig.nftId)}
        baseToken={{
          address: baseTokenConfig.address,
          symbol: baseToken.symbol,
          decimals: baseToken.decimals,
        }}
        quoteToken={{
          address: quoteTokenConfig.address,
          symbol: quoteToken.symbol,
          decimals: quoteToken.decimals,
        }}
        currentSqrtPriceX96={poolState.sqrtPriceX96}
        currentPriceDisplay={formatCompactValue(positionStates.current.poolPrice, quoteToken.decimals)}
      />
    </div>
  );
}
