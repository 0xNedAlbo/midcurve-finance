'use client';

/**
 * UniswapV3Actions - Action buttons for Uniswap V3 positions
 *
 * Protocol-specific component for position management actions.
 * Includes position management (increase, withdraw, collect fees) and
 * automation buttons (stop-loss, take-profit).
 */

import { useState, useMemo } from "react";
import { Plus, Minus, DollarSign } from "lucide-react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import type { ListPositionData } from "@midcurve/api-shared";
import { IncreaseDepositModal } from "@/components/positions/increase-deposit-modal";
import { WithdrawPositionModal } from "@/components/positions/withdraw-position-modal";
import { CollectFeesModal } from "@/components/positions/collect-fees-modal";
import { StopLossButton } from "@/components/positions/automation/StopLossButton";
import { TakeProfitButton } from "@/components/positions/automation/TakeProfitButton";
import { HedgeButton } from "@/components/positions/automation/HedgeButton";
import { FlashingPriceLabel } from "@/components/positions/automation/FlashingPriceLabel";
import { CreateHedgedPositionModal } from "@/components/positions/hedge/CreateHedgedPositionModal";
import { useSharedContract, useAutowallet } from "@/hooks/automation";
import { areAddressesEqual } from "@/utils/evm";
import { formatTriggerPrice, type TokenConfig } from "@/components/positions/automation/order-button-utils";

interface UniswapV3ActionsProps {
  position: ListPositionData;
  isInRange: boolean; // Future: May be used for range-specific actions
}

export function UniswapV3Actions({ position }: UniswapV3ActionsProps) {
  const { address: walletAddress, isConnected } = useAccount();
  const [showIncreaseModal, setShowIncreaseModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showCollectFeesModal, setShowCollectFeesModal] = useState(false);
  const [showHedgeModal, setShowHedgeModal] = useState(false);
  const hasUnclaimedFees = BigInt(position.unClaimedFees) > 0n;

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
  const { data: contractData } = useSharedContract(positionConfig.chainId);
  const { data: autowalletData } = useAutowallet();

  // Automation visibility checks
  const isChainSupported = contractData?.isSupported ?? false;
  const hasAutowallet = !!autowalletData?.address;
  const showAutomationButtons = position.isActive && isChainSupported && hasAutowallet;

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

  // Don't show action buttons if user doesn't own the position
  if (!isOwner) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-700/50">
        <button
          onClick={() => setShowIncreaseModal(true)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer ${
            position.isActive
              ? "text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
              : "text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
          }`}
          disabled={!position.isActive}
        >
          <Plus className="w-3 h-3" />
          Increase Deposit
        </button>

        <button
          onClick={() => setShowWithdrawModal(true)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer ${
            position.isActive
              ? "text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
              : "text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
          }`}
          disabled={!position.isActive}
        >
          <Minus className="w-3 h-3" />
          Withdraw
        </button>

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

        {/* Automation Buttons - only visible when automation is available */}
        {showAutomationButtons && (
          <>
            {/* Divider between position actions and automation */}
            <div className="w-px h-6 bg-slate-600/50 mx-1" />

            <StopLossButton
              position={position}
              positionId={position.id}
              poolAddress={poolConfig.address}
              chainId={positionConfig.chainId}
              contractAddress={contractData!.contractAddress as Address}
              positionManager={contractData!.positionManager as Address}
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
            />

            {/* Current Price Display - between SL and TP buttons */}
            <FlashingPriceLabel price={currentPriceDisplay} symbol={quoteToken.symbol} />

            <TakeProfitButton
              position={position}
              positionId={position.id}
              poolAddress={poolConfig.address}
              chainId={positionConfig.chainId}
              contractAddress={contractData!.contractAddress as Address}
              positionManager={contractData!.positionManager as Address}
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
            />

            {/* Divider between automation and hedge */}
            <div className="w-px h-6 bg-slate-600/50 mx-1" />

            <HedgeButton onClick={() => setShowHedgeModal(true)} />
          </>
        )}
      </div>

      {/* Increase Deposit Modal */}
      <IncreaseDepositModal
        isOpen={showIncreaseModal}
        onClose={() => setShowIncreaseModal(false)}
        position={position}
        onIncreaseSuccess={() => {
          // Don't auto-close - user will click Finish button
          // Cache invalidation is handled by useUpdatePositionWithEvents
        }}
      />

      {/* Withdraw Modal */}
      <WithdrawPositionModal
        isOpen={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
        position={position}
        onWithdrawSuccess={() => {
          // Don't auto-close - user will click Finish button
          // Cache invalidation is handled by useUpdatePositionWithEvents
        }}
      />

      {/* Collect Fees Modal */}
      <CollectFeesModal
        isOpen={showCollectFeesModal}
        onClose={() => setShowCollectFeesModal(false)}
        position={position}
        onCollectSuccess={() => {
          // Don't auto-close - user will click Finish button
          // Cache invalidation is handled by useUpdatePositionWithEvents
        }}
      />

      {/* Create Hedged Position Modal */}
      <CreateHedgedPositionModal
        isOpen={showHedgeModal}
        onClose={() => setShowHedgeModal(false)}
        position={position}
      />
    </>
  );
}
