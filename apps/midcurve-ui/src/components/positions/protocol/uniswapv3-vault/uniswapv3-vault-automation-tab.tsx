"use client";

/**
 * UniswapV3 Vault Automation Tab
 *
 * Displays automation features for a vault position:
 * - Close order management (stop-loss, take-profit)
 * - Order history
 */

import { useCallback } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import type { Address } from "viem";
import { useVaultSharedContract } from "@/hooks/automation";
import { getChainSlugByChainId } from "@/config/chains";
import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
} from "@midcurve/api-shared";
import { VaultCloseOrdersPanel } from "../../automation";

interface UniswapV3VaultAutomationTabProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultAutomationTab({ position }: UniswapV3VaultAutomationTabProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Get quote token info for formatting
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;

  // Extract pool and position config for automation
  const config = position.config as UniswapV3VaultPositionConfigResponse;
  const state = position.state as UniswapV3VaultPositionStateResponse;
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  // Check if position is closed (shares balance = 0)
  const isPositionClosed = BigInt(state.sharesBalance || '0') === 0n;

  // Get shared vault automation contract for this chain
  const {
    data: contractData,
    isLoading: isContractLoading,
    error: contractError,
  } = useVaultSharedContract(config.chainId);

  // Navigate to Risk Triggers wizard
  const handleEditOrders = useCallback(() => {
    const chainSlug = getChainSlugByChainId(config.chainId);
    if (chainSlug) {
      navigate(`/positions/triggers/uniswapv3-vault/${chainSlug}/${config.vaultAddress}/${config.ownerAddress}`, {
        state: { returnTo: `${location.pathname}?tab=automation` },
      });
    }
  }, [navigate, location.pathname, config.chainId, config.vaultAddress]);

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
      <VaultCloseOrdersPanel
        positionId={position.id}
        chainId={config.chainId}
        vaultAddress={config.vaultAddress}
        ownerAddress={config.ownerAddress}
        contractAddress={contractAddress}
        quoteTokenSymbol={quoteToken.symbol}
        quoteTokenDecimals={quoteToken.decimals}
        baseTokenSymbol={baseToken.symbol}
        baseTokenDecimals={baseToken.decimals}
        baseTokenAddress={baseTokenConfig.address}
        quoteTokenAddress={quoteTokenConfig.address}
        isPositionClosed={isPositionClosed}
        onEditOrders={handleEditOrders}
      />
    </div>
  );
}
