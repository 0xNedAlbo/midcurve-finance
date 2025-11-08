/**
 * UniswapV3ChainBadge - Chain name and fee tier display for Uniswap V3 positions
 *
 * Protocol-specific component that shows EVM chain name and pool fee tier.
 */

import type { ListPositionData } from "@midcurve/api-shared";

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  42161: "Arbitrum",
  8453: "Base",
  56: "BSC",
  137: "Polygon",
  10: "Optimism",
};

interface UniswapV3ChainBadgeProps {
  position: ListPositionData;
}

export function UniswapV3ChainBadge({ position }: UniswapV3ChainBadgeProps) {
  const config = position.config as {
    chainId: number;
  };
  const poolConfig = position.pool.config as {
    feeBps: number; // Fee in basis points (e.g., 3000 = 0.30%)
  };

  const chainName = CHAIN_NAMES[config.chainId] || "Unknown";

  return (
    <>
      <span className="hidden md:inline">•</span>
      <span className="hidden sm:inline">{chainName}</span>
      <span className="hidden md:inline">•</span>
      <span>{(poolConfig.feeBps / 10000).toFixed(2)}%</span>
    </>
  );
}
