"use client";

/**
 * UniswapV3 Automation Tab
 *
 * Displays automation features for a Uniswap V3 position:
 * - Close order management (stop-loss, take-profit)
 * - Order history
 */

import { AlertCircle, Loader2 } from "lucide-react";
import type { Address } from "viem";
import { useSharedContract } from "@/hooks/automation";
import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import { PositionCloseOrdersPanel } from "../../automation";

interface UniswapV3AutomationTabProps {
  position: GetUniswapV3PositionResponse;
}

export function UniswapV3AutomationTab({ position }: UniswapV3AutomationTabProps) {
  // Get quote token info for formatting
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;

  // Extract pool and position config for automation
  const poolConfig = position.pool.config as { address: string; chainId: number };
  const positionConfig = position.config as { nftId: number };
  const positionState = position.state as { ownerAddress: string; liquidity: string };
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  // Check if position is closed (liquidity = 0)
  const isPositionClosed = BigInt(positionState.liquidity || '0') === 0n;

  // Get shared automation contract for this chain
  const {
    data: contractData,
    isLoading: isContractLoading,
    error: contractError,
  } = useSharedContract(poolConfig.chainId, positionConfig.nftId.toString());

  const contractAddress = contractData?.contractAddress as Address | undefined;
  const isChainSupported = contractData?.isSupported ?? false;

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
        nftId={positionConfig.nftId.toString()}
        contractAddress={contractAddress}
        positionOwner={positionState.ownerAddress as Address}
        quoteTokenSymbol={quoteToken.symbol}
        quoteTokenDecimals={quoteToken.decimals}
        baseTokenSymbol={baseToken.symbol}
        baseTokenDecimals={baseToken.decimals}
        baseTokenAddress={baseTokenConfig.address}
        quoteTokenAddress={quoteTokenConfig.address}
        isPositionClosed={isPositionClosed}
      />
    </div>
  );
}
