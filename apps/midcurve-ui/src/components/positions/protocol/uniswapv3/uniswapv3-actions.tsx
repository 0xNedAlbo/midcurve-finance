'use client';

/**
 * UniswapV3Actions - Action buttons for Uniswap V3 positions
 *
 * Protocol-specific component for position management actions.
 * Includes position management (increase, withdraw, collect fees) and
 * automation buttons (stop-loss, take-profit).
 */

import { useState, useMemo, useCallback } from "react";
import { Plus, Minus, DollarSign, Flame, Coins, Archive } from "lucide-react";
import { useAccount } from "wagmi";
import { useNavigate, useLocation } from "react-router-dom";
import type { Address } from "viem";
import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import { getChainSlugByChainId } from "@/config/chains";
import { UniswapV3CollectFeesModal } from "./uniswapv3-collect-fees-modal";
import { UniswapV3BurnNftModal } from "./uniswapv3-burn-nft-modal";
import { UniswapV3TokenizePositionModal } from "./uniswapv3-tokenize-position-modal";
import { StopLossButton } from "@/components/positions/automation/StopLossButton";
import { TakeProfitButton } from "@/components/positions/automation/TakeProfitButton";
import { FlashingPriceLabel } from "@/components/positions/automation/FlashingPriceLabel";
import { useSharedContract } from "@/hooks/automation";
import { areAddressesEqual } from "@/utils/evm";
import { useArchivePosition } from "@/hooks/positions/useArchivePosition";
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
  const hasUnclaimedFees = BigInt(position.unclaimedYield) > 0n;
  const archiveMutation = useArchivePosition();

  // Position lifecycle state — check on-chain conditions directly
  const hasLiquidity = BigInt((position.state as { liquidity: string }).liquidity) > 0n;
  const hasTokensOwed = BigInt((position.state as { tokensOwed0: string }).tokensOwed0) > 0n
    || BigInt((position.state as { tokensOwed1: string }).tokensOwed1) > 0n;
  const isBurned = (position.state as { isBurned?: boolean }).isBurned === true;

  // Extract owner address and ownership flags from position state
  const ownerAddress = position.state.ownerAddress;
  const isOwnedByUser = (position.state as { isOwnedByUser?: boolean }).isOwnedByUser ?? true;

  // Check if connected wallet owns this position (gates wallet-interaction buttons)
  const isOwner = !!(
    isConnected &&
    walletAddress &&
    ownerAddress &&
    areAddressesEqual(walletAddress, ownerAddress)
  );

  // Extract position data for automation buttons
  const poolConfig = position.pool.config as { address: string; chainId: number };
  const poolState = position.pool.state as { sqrtPriceX96: string };
  const positionConfig = position.config as { nftId: number; chainId: number };

  // Tokenize modal state driven by ?modal=tokenize query param for browser back navigation
  const showTokenizeModal = new URLSearchParams(location.search).get('modal') === 'tokenize';
  const openTokenizeModal = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.set('modal', 'tokenize');
    params.set('chainId', String(positionConfig.chainId));
    params.set('nftId', String(positionConfig.nftId));
    navigate(`${location.pathname}?${params.toString()}`, { state: location.state });
  }, [navigate, location, positionConfig.chainId, positionConfig.nftId]);
  const closeTokenizeModal = useCallback(() => {
    navigate(-1);
  }, [navigate]);

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
  // Automation availability checks
  const isChainSupported = contractData?.isSupported ?? false;

  // Calculate automation disabled state and reason
  const automationDisabled = isBurned || !hasLiquidity || !isChainSupported;

  const automationDisabledReason = useMemo(() => {
    if (isBurned) return 'NFT is burned';
    if (!hasLiquidity) return 'No liquidity in position';
    if (!isChainSupported) return 'Automation not supported on this chain';
    return undefined;
  }, [isBurned, hasLiquidity, isChainSupported]);

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


  // Archive-only views:
  // - Archived positions: show unarchive button
  // - Not owned by user (NFT owner not in user_wallets): show archive button always
  // - Owned by user but not by connected wallet: show archive only when empty
  if (!isOwner || position.isArchived) {
    const showArchiveButton = !isOwnedByUser || position.isArchived || (!hasLiquidity && !hasUnclaimedFees);
    if (!showArchiveButton) return null;
    return (
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-700/50">
        <button
          onClick={() => archiveMutation.mutate({ positionId: position.id, archive: !position.isArchived })}
          disabled={archiveMutation.isPending}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-slate-300 bg-slate-800/30 hover:bg-slate-700/30 border-slate-600/50 disabled:opacity-50"
        >
          <Archive className="w-3 h-3" />
          {archiveMutation.isPending
            ? (position.isArchived ? 'Unarchiving...' : 'Archiving...')
            : (position.isArchived ? 'Unarchive Position' : 'Archive Position')}
        </button>
      </div>
    );
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
          {!hasLiquidity ? 'Reopen Position' : 'Increase Deposit'}
        </button>

        {/* Withdraw — hidden when no liquidity */}
        {hasLiquidity && (
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

        {/* Collect Fees — hidden when no liquidity and no fees */}
        {(hasLiquidity || hasUnclaimedFees) && (
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

        {/* Burn NFT — shown when position has no liquidity, no owed tokens, no fees */}
        {!hasLiquidity && !hasTokensOwed && !hasUnclaimedFees && (
          <button
            onClick={() => setShowBurnModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-slate-300 bg-slate-800/30 hover:bg-slate-700/30 border-slate-600/50"
          >
            <Flame className="w-3 h-3" />
            Burn NFT
          </button>
        )}

        {/* Archive Position — shown when no liquidity and no unclaimed fees */}
        {!hasLiquidity && !hasUnclaimedFees && (
          <button
            onClick={() => archiveMutation.mutate({ positionId: position.id, archive: true })}
            disabled={archiveMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-slate-300 bg-slate-800/30 hover:bg-slate-700/30 border-slate-600/50 disabled:opacity-50"
          >
            <Archive className="w-3 h-3" />
            {archiveMutation.isPending ? 'Archiving...' : 'Archive Position'}
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
          closeOrders={position.closeOrders}
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
          closeOrders={position.closeOrders}
        />

        {/* Tokenize Position — only for positions with liquidity */}
        {hasLiquidity && (
          <>
            <div className="w-px h-6 bg-slate-600/50 mx-1" />
            <button
              onClick={openTokenizeModal}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-violet-300 bg-violet-900/20 hover:bg-violet-800/30 border-violet-600/50"
            >
              <Coins className="w-3 h-3" />
              Tokenize
            </button>
          </>
        )}

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

      {/* Tokenize Position Modal */}
      <UniswapV3TokenizePositionModal
        isOpen={showTokenizeModal}
        onClose={closeTokenizeModal}
        position={position}
      />

    </>
  );
}
