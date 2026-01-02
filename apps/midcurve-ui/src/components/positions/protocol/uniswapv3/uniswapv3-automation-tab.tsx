"use client";

/**
 * UniswapV3 Automation Tab
 *
 * Displays automation features for a Uniswap V3 position:
 * - Close order management (stop-loss, take-profit)
 * - Order history
 */

import { useState } from "react";
import { formatCompactValue } from "@/lib/fraction-format";
import { calculatePositionStates } from "@/lib/position-states";
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
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

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

  return (
    <div className="space-y-6">
      {/* Close Orders Panel */}
      <PositionCloseOrdersPanel
        positionId={position.id}
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
