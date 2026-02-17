/**
 * Cancel Order Confirm Modal
 *
 * Simple confirmation dialog for cancelling a close order (stop-loss or take-profit).
 * Shows order details and requires user confirmation before proceeding.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Loader2, CheckCircle, Trash2 } from 'lucide-react';
import type { SerializedCloseOrder, TriggerMode } from '@midcurve/api-shared';
import { tickToSqrtRatioX96 } from '@midcurve/shared';
import { useCancelCloseOrder, type OrderType } from '@/hooks/automation';
import { formatTriggerPriceFromTick, type TokenConfig } from './order-button-utils';
import { PnLSimulation } from './PnLSimulation';

interface CancelOrderConfirmModalProps {
  /**
   * Whether the modal is open
   */
  isOpen: boolean;

  /**
   * Close the modal
   */
  onClose: () => void;

  /**
   * The close order to cancel
   */
  order: SerializedCloseOrder;

  /**
   * Token configuration for price display
   */
  tokenConfig: TokenConfig;

  /**
   * Chain ID
   */
  chainId: number;

  /**
   * NFT ID for position-scoped API (as string)
   */
  nftId: string;

  /**
   * Callback when cancellation succeeds
   */
  onSuccess?: () => void;

  // Position data for PnL simulation
  /**
   * Position liquidity
   */
  liquidity: bigint;

  /**
   * Position lower tick
   */
  tickLower: number;

  /**
   * Position upper tick
   */
  tickUpper: number;

  /**
   * Current cost basis (in quote token units, as string)
   */
  currentCostBasis: string;

  /**
   * Current unclaimed fees (in quote token units, as string)
   */
  unclaimedFees: string;

  /**
   * Current pool price (sqrtPriceX96)
   */
  currentSqrtPriceX96: string;

  /**
   * Whether token0 is the quote token
   */
  isToken0Quote: boolean;
}

/**
 * Get label for order type
 */
function getOrderTypeLabel(triggerMode: TriggerMode): string {
  switch (triggerMode) {
    case 'LOWER':
      return 'Stop-Loss';
    case 'UPPER':
      return 'Take-Profit';
    default:
      return 'Close Order';
  }
}

export function CancelOrderConfirmModal({
  isOpen,
  onClose,
  order,
  tokenConfig,
  chainId,
  nftId,
  onSuccess,
  // Position data for PnL simulation
  liquidity,
  tickLower,
  tickUpper,
  currentCostBasis,
  unclaimedFees,
  currentSqrtPriceX96,
  isToken0Quote,
}: CancelOrderConfirmModalProps) {
  const [mounted, setMounted] = useState(false);

  // Cancel order hook - fetches ABI internally
  const {
    cancelOrder,
    isCancelling,
    isWaitingForConfirmation,
    isSuccess,
    error,
    reset,
    isReady: isHookReady,
  } = useCancelCloseOrder(chainId, nftId);

  // Mount check for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  // Notify parent of success (for cache invalidation) but don't auto-close
  useEffect(() => {
    if (isSuccess) {
      onSuccess?.();
    }
  }, [isSuccess, onSuccess]);

  // Use explicit fields from the order
  const triggerMode = order.triggerMode;
  const priceDisplay = formatTriggerPriceFromTick(order.triggerTick, tokenConfig);
  const orderTypeLabel = getOrderTypeLabel(triggerMode);

  // Convert triggerTick to sqrtPriceX96 for PnLSimulation
  const triggerSqrtPriceX96 = useMemo(() => {
    if (order.triggerTick === null) return undefined;
    try {
      return tickToSqrtRatioX96(order.triggerTick).toString();
    } catch {
      return undefined;
    }
  }, [order.triggerTick]);

  // Handle cancel confirmation
  const handleConfirm = () => {
    if (!order.closeOrderHash) {
      console.error('Order missing closeOrderHash');
      return;
    }

    if (!isHookReady) {
      console.error('Hook not ready');
      return;
    }

    // Map triggerMode to orderType (V1.0 tick-based interface)
    // When isToken0Quote=true, the order type is inverted because tick direction is opposite to user price direction
    const orderTypeFromTriggerMode: Record<TriggerMode, OrderType> = isToken0Quote
      ? {
          'LOWER': 'TAKE_PROFIT',  // Lower user price → tick rises → TAKE_PROFIT
          'UPPER': 'STOP_LOSS',    // Upper user price → tick falls → STOP_LOSS
        }
      : {
          'LOWER': 'STOP_LOSS',    // Lower user price → tick falls → STOP_LOSS
          'UPPER': 'TAKE_PROFIT',  // Upper user price → tick rises → TAKE_PROFIT
        };
    const orderType: OrderType = orderTypeFromTriggerMode[triggerMode];

    cancelOrder({ orderType });
  };

  // Don't allow close during processing (but allow when success)
  const handleClose = () => {
    if (isCancelling || isWaitingForConfirmation) return;
    onClose();
  };

  const isProcessing = isCancelling || isWaitingForConfirmation;

  // Determine which view to show
  const showSuccessView = isSuccess;

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={!isProcessing ? handleClose : undefined}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-xl shadow-black/20 w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              {showSuccessView && (
                <div className="p-2 border rounded-lg bg-green-500/10 border-green-500/20">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                </div>
              )}
              <h2 className="text-lg font-semibold text-white">
                {showSuccessView ? 'Order Cancelled' : `${orderTypeLabel} Order`}
              </h2>
            </div>
            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {showSuccessView ? (
              <>
                <p className="text-slate-300">
                  Your {orderTypeLabel.toLowerCase()} order has been successfully cancelled.
                </p>

                {/* Cancelled order details */}
                <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Order Type:</span>
                    <span className="text-slate-200 font-medium">{orderTypeLabel}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Trigger Price:</span>
                    <span className="text-slate-200 font-mono">
                      {priceDisplay} {tokenConfig.quoteTokenSymbol}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-slate-300">
                  If you want to cancel this order, use the red button below.
                </p>

                {/* Order details */}
                <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Order Type:</span>
                    <span className="text-slate-200 font-medium">{orderTypeLabel}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Trigger Price:</span>
                    <span className="text-slate-200 font-mono">
                      {priceDisplay} {tokenConfig.quoteTokenSymbol}
                    </span>
                  </div>
                </div>

                {/* PnL Simulation - shows expected PnL if order triggers */}
                {triggerSqrtPriceX96 && (
                  <PnLSimulation
                    liquidity={liquidity}
                    tickLower={tickLower}
                    tickUpper={tickUpper}
                    currentCostBasis={currentCostBasis}
                    unclaimedFees={unclaimedFees}
                    triggerSqrtPriceX96={triggerSqrtPriceX96}
                    currentSqrtPriceX96={currentSqrtPriceX96}
                    isToken0Quote={isToken0Quote}
                    quoteToken={{
                      decimals: tokenConfig.quoteTokenDecimals,
                      symbol: tokenConfig.quoteTokenSymbol,
                    }}
                    triggerMode={triggerMode}
                    label="Expected PnL if order triggers:"
                  />
                )}

                {/* Error message */}
                {error && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <p className="text-sm text-red-400">{error.message}</p>
                  </div>
                )}

                {/* Processing state */}
                {isProcessing && (
                  <div className="flex items-center gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                    <p className="text-sm text-blue-300">
                      {isCancelling
                        ? 'Please confirm in your wallet...'
                        : 'Waiting for confirmation...'}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-slate-700/50 flex items-center justify-between">
            {showSuccessView ? (
              <button
                onClick={handleClose}
                className="w-1/2 ml-auto px-4 py-2 text-sm font-medium text-white bg-slate-600 hover:bg-slate-500 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            ) : (
              <>
                <button
                  onClick={handleConfirm}
                  disabled={isProcessing}
                  className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Cancel order"
                >
                  {isProcessing ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Trash2 className="w-5 h-5" />
                  )}
                </button>
                <button
                  onClick={handleClose}
                  disabled={isProcessing}
                  className="w-1/2 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Keep Order
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
