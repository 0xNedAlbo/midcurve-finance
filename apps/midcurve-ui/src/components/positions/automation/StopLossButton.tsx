/**
 * Stop Loss Button
 *
 * Action button for creating or displaying a stop-loss order.
 *
 * States:
 * - No order: Green "+ | Stop Loss" button (clickable to create)
 * - Order exists: Pink "SL @{price} | x" display (X clickable to cancel)
 */

'use client';

import { useState, useMemo } from 'react';
import { Plus, X as XIcon } from 'lucide-react';
import type { Address } from 'viem';
import type { ListPositionData, TriggerMode } from '@midcurve/api-shared';
import { useCloseOrders } from '@/hooks/automation';
import { CloseOrderModal } from './CloseOrderModal';
import { CancelOrderConfirmModal } from './CancelOrderConfirmModal';
import {
  findClosestOrder,
  getOrderButtonLabel,
  type TokenConfig,
} from './order-button-utils';

interface StopLossButtonProps {
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
   * Shared automation contract address
   */
  contractAddress: Address;

  /**
   * Position manager (NFPM) address
   */
  positionManager: Address;

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
}

export function StopLossButton({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  position: _position, // Reserved for future use with PnL curve
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
}: StopLossButtonProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  // Fetch close orders for this position
  const { data: orders = [] } = useCloseOrders({ positionId });

  // Build token config for utilities
  const tokenConfig: TokenConfig = useMemo(
    () => ({
      baseTokenAddress: baseToken.address,
      quoteTokenAddress: quoteToken.address,
      baseTokenDecimals: baseToken.decimals,
      quoteTokenDecimals: quoteToken.decimals,
      quoteTokenSymbol: quoteToken.symbol,
    }),
    [baseToken, quoteToken]
  );

  // Find the closest active stop-loss order
  const activeOrder = useMemo(() => {
    return findClosestOrder(orders, currentPriceDisplay, 'LOWER' as TriggerMode, tokenConfig);
  }, [orders, currentPriceDisplay, tokenConfig]);

  // Generate button label if order exists
  const buttonLabel = useMemo(() => {
    if (!activeOrder) return null;
    return getOrderButtonLabel(activeOrder, 'stopLoss', tokenConfig);
  }, [activeOrder, tokenConfig]);

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
          Stop Loss
        </button>

        {/* Create Modal */}
        <CloseOrderModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          positionId={positionId}
          poolAddress={poolAddress}
          chainId={chainId}
          contractAddress={contractAddress}
          positionManager={positionManager}
          nftId={nftId}
          positionOwner={positionOwner}
          baseToken={baseToken}
          quoteToken={quoteToken}
          currentSqrtPriceX96={currentSqrtPriceX96}
          currentPriceDisplay={currentPriceDisplay}
          isToken0Quote={isToken0Quote}
          orderType="stopLoss"
        />
      </>
    );
  }

  // If active order exists, show display button (pink) with cancel X
  return (
    <>
      <div className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-pink-300 bg-pink-900/20 border-pink-600/50">
        <span>{buttonLabel}</span>
        <button
          onClick={handleCancelClick}
          className="ml-1 p-0.5 hover:bg-pink-800/50 rounded transition-colors cursor-pointer"
          title="Cancel order"
        >
          <XIcon className="w-3 h-3" />
        </button>
      </div>

      {/* Cancel Confirmation Modal */}
      <CancelOrderConfirmModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        order={activeOrder}
        tokenConfig={tokenConfig}
        contractAddress={contractAddress}
        chainId={chainId}
        onSuccess={() => setShowCancelModal(false)}
      />
    </>
  );
}
