/**
 * Take Profit Button
 *
 * Action button for creating or displaying a take-profit order.
 *
 * States:
 * - No order: Green "+ | Take Profit" button (clickable to create)
 * - Order active: Pink "TP @{price} | x" display (X clickable to cancel)
 * - Order executing: Amber spinner + "TP @{price}" (no cancel, order is being executed)
 */

'use client';

import { useState, useMemo, useEffect } from 'react';
import { Plus, X as XIcon, ArrowRight, Loader2 } from 'lucide-react';
import type { Address } from 'viem';
import type { ListPositionData, TriggerMode } from '@midcurve/api-shared';
import { useCloseOrders } from '@/hooks/automation';
import { CloseOrderModal } from './CloseOrderModal';
import { CancelOrderConfirmModal } from './CancelOrderConfirmModal';
import {
  findClosestOrder,
  getOrderButtonLabel,
  isOrderExecuting,
  type TokenConfig,
} from './order-button-utils';

interface TakeProfitButtonProps {
  /**
   * Position data
   */
  position: ListPositionData;

  /**
   * Position ID for fetching orders
   */
  positionId: string;

  /**
   * Pool address
   */
  poolAddress: string;

  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Shared automation contract address (optional when disabled)
   */
  contractAddress?: Address;

  /**
   * Position manager (NFPM) address (optional when disabled)
   */
  positionManager?: Address;

  /**
   * NFT ID of the position
   */
  nftId: bigint;

  /**
   * Position owner address
   */
  positionOwner: Address;

  /**
   * Current price display string
   */
  currentPriceDisplay: string;

  /**
   * Current sqrtPriceX96 as string
   */
  currentSqrtPriceX96: string;

  /**
   * Base token info
   */
  baseToken: {
    address: string;
    symbol: string;
    decimals: number;
  };

  /**
   * Quote token info
   */
  quoteToken: {
    address: string;
    symbol: string;
    decimals: number;
  };

  /**
   * Whether token0 is the quote token
   */
  isToken0Quote: boolean;

  /**
   * Whether the button is disabled
   */
  disabled?: boolean;

  /**
   * Reason why the button is disabled (shown as tooltip)
   */
  disabledReason?: string;
}

export function TakeProfitButton({
  position,
  positionId,
  poolAddress,
  chainId,
  contractAddress,
  positionManager,
  nftId,
  positionOwner,
  currentPriceDisplay,
  currentSqrtPriceX96,
  baseToken,
  quoteToken,
  isToken0Quote,
  disabled = false,
  disabledReason,
}: TakeProfitButtonProps) {
  // If disabled, show disabled button with tooltip
  if (disabled) {
    return (
      <button
        disabled
        title={disabledReason}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
      >
        <Plus className="w-3 h-3" />
        Take Profit
      </button>
    );
  }

  // Extract position data for PnL simulation
  const positionState = position.state as { liquidity: string };
  const positionConfig = position.config as { tickLower: number; tickUpper: number };
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  // Fetch close orders for this position with polling enabled
  // Polling speeds up automatically when an order is executing
  const { data: orders = [] } = useCloseOrders({
    chainId,
    nftId: nftId.toString(),
    polling: true,
  });

  // Build token config for utilities
  const tokenConfig: TokenConfig = useMemo(
    () => ({
      baseTokenAddress: baseToken.address,
      quoteTokenAddress: quoteToken.address,
      baseTokenDecimals: baseToken.decimals,
      quoteTokenDecimals: quoteToken.decimals,
      baseTokenSymbol: baseToken.symbol,
      quoteTokenSymbol: quoteToken.symbol,
    }),
    [baseToken, quoteToken]
  );

  // Find the closest active take-profit order
  const activeOrder = useMemo(() => {
    return findClosestOrder(orders, currentPriceDisplay, 'UPPER' as TriggerMode, tokenConfig);
  }, [orders, currentPriceDisplay, tokenConfig]);

  // Generate button label if order exists
  const buttonLabel = useMemo(() => {
    if (!activeOrder) return null;
    return getOrderButtonLabel(activeOrder, 'takeProfit', tokenConfig);
  }, [activeOrder, tokenConfig]);

  // Check if order is currently executing
  const isExecuting = activeOrder ? isOrderExecuting(activeOrder) : false;

  // Reset modal states when activeOrder changes
  // - When order is created (activeOrder becomes truthy): close create modal
  // - When order is cancelled (activeOrder becomes falsy): close cancel modal
  useEffect(() => {
    if (activeOrder) {
      // Order exists - close create modal if it was open
      if (showCreateModal) {
        setShowCreateModal(false);
      }
    } else {
      // No order - close cancel modal if it was open
      if (showCancelModal) {
        setShowCancelModal(false);
      }
    }
  }, [activeOrder, showCreateModal, showCancelModal]);

  // Handle create button click
  const handleCreateClick = () => {
    setShowCreateModal(true);
  };

  // Handle cancel X click
  const handleCancelClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering parent click
    setShowCancelModal(true);
  };

  // If no active order, show create button (green)
  if (!activeOrder) {
    return (
      <>
        <button
          onClick={handleCreateClick}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
        >
          <Plus className="w-3 h-3" />
          Take Profit
        </button>

        {/* Create Modal */}
        <CloseOrderModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          positionId={positionId}
          poolAddress={poolAddress}
          chainId={chainId}
          contractAddress={contractAddress!}
          positionManager={positionManager!}
          nftId={nftId}
          positionOwner={positionOwner}
          baseToken={baseToken}
          quoteToken={quoteToken}
          currentSqrtPriceX96={currentSqrtPriceX96}
          currentPriceDisplay={currentPriceDisplay}
          isToken0Quote={isToken0Quote}
          orderType="takeProfit"
          // Position data for PnL simulation
          liquidity={BigInt(positionState.liquidity)}
          tickLower={positionConfig.tickLower}
          tickUpper={positionConfig.tickUpper}
          currentCostBasis={position.currentCostBasis}
          unclaimedFees={position.unClaimedFees}
        />
      </>
    );
  }

  // If order is executing, show amber spinner state (no cancel button)
  if (isExecuting) {
    return (
      <div className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-amber-300 bg-amber-900/20 border-amber-600/50">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="flex items-center gap-0.5">
          {buttonLabel!.prefix} @{buttonLabel!.priceDisplay}
          {buttonLabel!.hasSwap && (
            <>
              <ArrowRight className="w-3 h-3 mx-0.5" />
              {buttonLabel!.targetSymbol}
            </>
          )}
        </span>
      </div>
    );
  }

  // If active order exists, show display button (pink) - entire button clickable to cancel
  return (
    <>
      <button
        onClick={handleCancelClick}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-pink-300 bg-pink-900/20 hover:bg-pink-800/30 border-pink-600/50 transition-colors cursor-pointer"
        title="Click to cancel order"
      >
        <span className="flex items-center gap-0.5">
          {buttonLabel!.prefix} @{buttonLabel!.priceDisplay}
          {buttonLabel!.hasSwap && (
            <>
              <ArrowRight className="w-3 h-3 mx-0.5" />
              {buttonLabel!.targetSymbol}
            </>
          )}
        </span>
        <XIcon className="w-3 h-3 ml-1" />
      </button>

      {/* Cancel Confirmation Modal */}
      <CancelOrderConfirmModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        order={activeOrder}
        tokenConfig={tokenConfig}
        contractAddress={contractAddress!}
        chainId={chainId}
        nftId={nftId.toString()}
        onSuccess={() => setShowCancelModal(false)}
        // Position data for PnL simulation
        liquidity={BigInt(positionState.liquidity)}
        tickLower={positionConfig.tickLower}
        tickUpper={positionConfig.tickUpper}
        currentCostBasis={position.currentCostBasis}
        unclaimedFees={position.unClaimedFees}
        currentSqrtPriceX96={currentSqrtPriceX96}
        isToken0Quote={isToken0Quote}
      />
    </>
  );
}
