/**
 * Cancel Order Confirm Modal
 *
 * Simple confirmation dialog for cancelling a close order (stop-loss or take-profit).
 * Shows order details and requires user confirmation before proceeding.
 */

'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import type { SerializedCloseOrder, TriggerMode } from '@midcurve/api-shared';
import type { Address } from 'viem';
import { useCancelCloseOrder } from '@/hooks/automation';
import { formatTriggerPrice, type TokenConfig } from './order-button-utils';

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
   * Contract address for the automation contract
   */
  contractAddress: Address;

  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Callback when cancellation succeeds
   */
  onSuccess?: () => void;
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
    case 'BOTH':
      return 'Range Exit';
    default:
      return 'Close Order';
  }
}

export function CancelOrderConfirmModal({
  isOpen,
  onClose,
  order,
  tokenConfig,
  contractAddress,
  chainId,
  onSuccess,
}: CancelOrderConfirmModalProps) {
  const [mounted, setMounted] = useState(false);

  // Cancel order hook
  const {
    cancelOrder,
    isCancelling,
    isWaitingForConfirmation,
    isSuccess,
    error,
    reset,
  } = useCancelCloseOrder();

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

  // Extract order config
  const config = order.config as {
    triggerMode?: TriggerMode;
    sqrtPriceX96Lower?: string;
    sqrtPriceX96Upper?: string;
    closeId?: number;
  };

  const triggerMode = config.triggerMode ?? 'LOWER';
  const sqrtPriceX96 =
    triggerMode === 'LOWER' || triggerMode === 'BOTH'
      ? config.sqrtPriceX96Lower
      : config.sqrtPriceX96Upper;

  const priceDisplay = formatTriggerPrice(sqrtPriceX96, tokenConfig);
  const orderTypeLabel = getOrderTypeLabel(triggerMode);

  // Handle cancel confirmation
  const handleConfirm = () => {
    if (config.closeId === undefined) {
      console.error('Order missing closeId');
      return;
    }

    cancelOrder({
      contractAddress,
      chainId,
      closeId: BigInt(config.closeId),
      orderId: order.id,
      positionId: order.positionId,
    });
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
              <div className={`p-2 border rounded-lg ${
                showSuccessView
                  ? 'bg-green-500/10 border-green-500/20'
                  : 'bg-amber-500/10 border-amber-500/20'
              }`}>
                {showSuccessView ? (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                )}
              </div>
              <h2 className="text-lg font-semibold text-white">
                {showSuccessView ? 'Order Cancelled' : 'Cancel Order'}
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
                  Are you sure you want to cancel this {orderTypeLabel.toLowerCase()} order?
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
          <div className="p-6 border-t border-slate-700/50 flex gap-3">
            {showSuccessView ? (
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-slate-600 hover:bg-slate-500 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            ) : (
              <>
                <button
                  onClick={handleClose}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Keep Order
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    'Cancel Order'
                  )}
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
