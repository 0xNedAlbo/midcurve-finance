'use client';

/**
 * UniswapV3Actions - Action buttons for Uniswap V3 positions
 *
 * Protocol-specific component for position management actions.
 * Includes position management (increase, withdraw, collect fees) and
 * automation buttons (stop-loss, take-profit).
 */

import { useState, useMemo } from "react";
import { Plus, Minus, DollarSign, Flame } from "lucide-react";
import { useAccount } from "wagmi";
import { useNavigate, useLocation } from "react-router-dom";
import type { Address } from "viem";
import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import { getChainSlugByChainId } from "@/config/chains";
import { UniswapV3CollectFeesModal } from "./uniswapv3-collect-fees-modal";
import { UniswapV3BurnNftModal } from "./uniswapv3-burn-nft-modal";
import { StopLossButton } from "@/components/positions/automation/StopLossButton";
import { TakeProfitButton } from "@/components/positions/automation/TakeProfitButton";
import { FlashingPriceLabel } from "@/components/positions/automation/FlashingPriceLabel";
import { useSharedContract, useAutowallet } from "@/hooks/automation";
import { areAddressesEqual } from "@/utils/evm";
import { formatTriggerPrice, type TokenConfig } from "@/components/positions/automation/order-button-utils";

interface UniswapV3ActionsProps {
  position: UniswapV3PositionData;
  isInRange: boolean; // Future: May be used for range-specific actions
}

export function UniswapV3Actions({ position }: UniswapV3ActionsProps) {
  const { address: walletAddress, isConnected } = useAccount();
  const navigate = useNavigate();
  const location = useLocation();
  const [showCollectFeesModal, setShowCollectFeesModal] = useState(false);
  const [showBurnModal, setShowBurnModal] = useState(false);
  const hasUnclaimedFees = BigInt(position.unClaimedFees) > 0n;

  // Position lifecycle state
  const positionState = position.state as { isClosed?: boolean; ownerAddress: string };
  const isClosed = positionState.isClosed ?? false;

  // Extract owner address from position state
  const ownerAddress = position.state.ownerAddress;

  // Extract position data for automation buttons
  const poolConfig = position.pool.config as { address: string; chainId: number };
  const poolState = position.pool.state as { sqrtPriceX96: string };
  const positionConfig = position.config as { nftId: number; chainId: number };

  // Get base/quote tokens
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  // Check automation availability for this chain
  const { data: contractData } = useSharedContract(
    positionConfig.chainId,
    positionConfig.nftId.toString()
  );
  const { data: autowalletData } = useAutowallet();

  // Automation availability checks
  const isChainSupported = contractData?.isSupported ?? false;
  const hasAutowallet = !!autowalletData?.address;

  // Calculate automation disabled state and reason
  const automationDisabled = !position.isActive || isClosed || !isChainSupported || !hasAutowallet;

  const automationDisabledReason = useMemo(() => {
    if (!position.isActive || isClosed) return 'Position is closed';
    if (!isChainSupported) return 'Automation not supported on this chain';
    if (!hasAutowallet) return 'No automation wallet configured';
    return undefined;
  }, [position.isActive, isClosed, isChainSupported, hasAutowallet]);

  // Build token config for price display
  const tokenConfig: TokenConfig = useMemo(
    () => ({
      baseTokenAddress: baseTokenConfig.address,
      quoteTokenAddress: quoteTokenConfig.address,
      baseTokenDecimals: baseToken.decimals,
      quoteTokenDecimals: quoteToken.decimals,
      baseTokenSymbol: baseToken.symbol,
      quoteTokenSymbol: quoteToken.symbol,
    }),
    [baseTokenConfig.address, quoteTokenConfig.address, baseToken.decimals, quoteToken.decimals, baseToken.symbol, quoteToken.symbol]
  );

  // Calculate current price display
  const currentPriceDisplay = useMemo(() => {
    return formatTriggerPrice(poolState.sqrtPriceX96, tokenConfig);
  }, [poolState.sqrtPriceX96, tokenConfig]);

  // Check if connected wallet owns this position
  const isOwner = !!(
    isConnected &&
    walletAddress &&
    ownerAddress &&
    areAddressesEqual(walletAddress, ownerAddress)
  );

  // Don't show action buttons if position is inactive (burned) or user doesn't own it
  if (!position.isActive) {
    return null;
  }
  if (!isOwner) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-700/50">
        {/* Increase Deposit / Reopen Position */}
        <button
          onClick={() => {
            const chainSlug = getChainSlugByChainId(positionConfig.chainId);
            if (chainSlug) {
              navigate(`/positions/increase/uniswapv3/${chainSlug}/${positionConfig.nftId}`, { state: { returnTo: location.pathname } });
            }
          }}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
        >
          <Plus className="w-3 h-3" />
          {isClosed ? 'Reopen Position' : 'Increase Deposit'}
        </button>

        {/* Withdraw — hidden for closed positions */}
        {!isClosed && (
          <button
            onClick={() => {
              const chainSlug = getChainSlugByChainId(positionConfig.chainId);
              if (chainSlug) {
                navigate(`/positions/withdraw/uniswapv3/${chainSlug}/${positionConfig.nftId}`, { state: { returnTo: location.pathname } });
              }
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
          >
            <Minus className="w-3 h-3" />
            Withdraw
          </button>
        )}

        {/* Collect Fees — hidden for closed positions */}
        {!isClosed && (
          <button
            onClick={() => setShowCollectFeesModal(true)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
              hasUnclaimedFees
                ? "text-amber-300 bg-amber-900/20 hover:bg-amber-800/30 border-amber-600/50 cursor-pointer"
                : "text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
            }`}
            disabled={!hasUnclaimedFees}
          >
            <DollarSign className="w-3 h-3" />
            Collect Fees
          </button>
        )}

        {/* Burn NFT — shown only for closed, not-burned positions */}
        {isClosed && (
          <button
            onClick={() => setShowBurnModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-slate-300 bg-slate-800/30 hover:bg-slate-700/30 border-slate-600/50"
          >
            <Flame className="w-3 h-3" />
            Burn NFT
          </button>
        )}

        {/* Automation Buttons - always visible, disabled when unavailable */}
        {/* Divider between position actions and automation */}
        <div className="w-px h-6 bg-slate-600/50 mx-1" />

        <StopLossButton
          position={position}
          positionId={position.id}
          poolAddress={poolConfig.address}
          chainId={positionConfig.chainId}
          contractAddress={automationDisabled ? undefined : contractData!.contractAddress as Address}
          positionManager={automationDisabled ? undefined : contractData!.positionManager as Address}
          nftId={BigInt(positionConfig.nftId)}
          positionOwner={ownerAddress as Address}
          currentPriceDisplay={currentPriceDisplay}
          currentSqrtPriceX96={poolState.sqrtPriceX96}
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
          isToken0Quote={position.isToken0Quote}
          disabled={automationDisabled}
          disabledReason={automationDisabledReason}
          activeCloseOrders={position.activeCloseOrders}
        />

        {/* Current Price Display - between SL and TP buttons */}
        <FlashingPriceLabel price={currentPriceDisplay} symbol={quoteToken.symbol} />

        <TakeProfitButton
          position={position}
          positionId={position.id}
          poolAddress={poolConfig.address}
          chainId={positionConfig.chainId}
          contractAddress={automationDisabled ? undefined : contractData!.contractAddress as Address}
          positionManager={automationDisabled ? undefined : contractData!.positionManager as Address}
          nftId={BigInt(positionConfig.nftId)}
          positionOwner={ownerAddress as Address}
          currentPriceDisplay={currentPriceDisplay}
          currentSqrtPriceX96={poolState.sqrtPriceX96}
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
          isToken0Quote={position.isToken0Quote}
          disabled={automationDisabled}
          disabledReason={automationDisabledReason}
          activeCloseOrders={position.activeCloseOrders}
        />

      </div>

      {/* Collect Fees Modal */}
      <UniswapV3CollectFeesModal
        isOpen={showCollectFeesModal}
        onClose={() => setShowCollectFeesModal(false)}
        position={position}
        onCollectSuccess={() => {
          // Don't auto-close - user will click Finish button
          // Position data will be refreshed on next view
        }}
      />

      {/* Burn NFT Modal */}
      <UniswapV3BurnNftModal
        isOpen={showBurnModal}
        onClose={() => setShowBurnModal(false)}
        position={position}
      />

    </>
  );
}
