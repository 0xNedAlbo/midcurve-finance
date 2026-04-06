/**
 * UniswapV3VaultChainBadge - Chain name, fee tier, and vault indicator for vault positions
 *
 * Protocol-specific component that shows EVM chain name, pool fee tier, and "Vault" label.
 */

import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type { UniswapV3VaultPositionConfigResponse } from "@midcurve/api-shared";

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  42161: "Arbitrum",
  8453: "Base",
  31337: "Local",
};

interface UniswapV3VaultChainBadgeProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultChainBadge({ position }: UniswapV3VaultChainBadgeProps) {
  const config = position.config as UniswapV3VaultPositionConfigResponse;
  const poolConfig = position.pool.config as { feeBps: number };

  const chainName = CHAIN_NAMES[config.chainId] || "Unknown";

  return (
    <>
      <span className="hidden md:inline">•</span>
      <span className="hidden sm:inline">{chainName}</span>
      <span className="hidden md:inline">•</span>
      <span>{(poolConfig.feeBps / 10000).toFixed(2)}%</span>
      <span className="hidden md:inline">•</span>
      <span>Tokenized</span>
    </>
  );
}
