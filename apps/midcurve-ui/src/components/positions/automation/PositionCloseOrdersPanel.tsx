/**
 * Position Close Orders Panel
 *
 * Panel for position detail page showing:
 * - Active close orders for this position
 * - "Set Close Order" button to create new ones
 * - Loading and error states
 */

import { useState } from 'react';
import { Plus, AlertCircle, Loader2, Shield } from 'lucide-react';
import type { Address } from 'viem';
import type { SerializedUniswapV3CloseOrderConfig } from '@midcurve/api-shared';
import { useCloseOrders } from '@/hooks/automation';
import { useCancelCloseOrder } from '@/hooks/automation';
import { CloseOrderCard } from './CloseOrderCard';
import { isCloseOrderTerminal } from './CloseOrderStatusBadge';
import { AutomationLogList } from './AutomationLogList';

interface PositionCloseOrdersPanelProps {
  /**
   * Position ID to fetch orders for
   */
  positionId: string;

  /**
   * Chain ID of the position
   */
  chainId: number;

  /**
   * Automation contract address on this chain
   * Optional - when undefined, shows empty state but allows creating orders
   */
  contractAddress?: Address;

  /**
   * Quote token symbol
   */
  quoteTokenSymbol: string;

  /**
   * Quote token decimals
   */
  quoteTokenDecimals: number;

  /**
   * Base token symbol
   */
  baseTokenSymbol: string;

  /**
   * Base token decimals
   */
  baseTokenDecimals: number;

  /**
   * Base token address for price conversion
   */
  baseTokenAddress: string;

  /**
   * Quote token address for price conversion
   */
  quoteTokenAddress: string;

  /**
   * Callback to open the create order modal
   */
  onCreateOrder?: () => void;

  /**
   * Whether the position is closed (liquidity = 0)
   * When true, disables order creation
   */
  isPositionClosed?: boolean;
}

export function PositionCloseOrdersPanel({
  positionId,
  chainId,
  contractAddress,
  quoteTokenSymbol,
  quoteTokenDecimals,
  baseTokenSymbol,
  baseTokenDecimals,
  baseTokenAddress,
  quoteTokenAddress,
  onCreateOrder,
  isPositionClosed = false,
}: PositionCloseOrdersPanelProps) {
  // Track which order is being cancelled
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  // Whether contract exists - determines if we can fetch orders
  const hasContract = !!contractAddress;

  // Fetch close orders for this position (only if contract exists)
  const { data: orders, isLoading, error, refetch } = useCloseOrders(
    { positionId, polling: true },
    { enabled: !!positionId && hasContract }
  );

  // Cancel hook
  const {
    cancelOrder,
    isCancelling,
    isWaitingForConfirmation,
    isSuccess: isCancelSuccess,
    error: cancelError,
    reset: resetCancel,
  } = useCancelCloseOrder();

  // Filter to show active orders first, then terminal ones
  const activeOrders = orders?.filter((o) => !isCloseOrderTerminal(o.status)) ?? [];
  const terminalOrders = orders?.filter((o) => isCloseOrderTerminal(o.status)) ?? [];

  // Has any active (non-terminal) orders
  const hasActiveOrders = activeOrders.length > 0;

  // Handle cancel success
  if (isCancelSuccess && cancellingOrderId) {
    setCancellingOrderId(null);
    resetCancel();
    refetch();
  }

  // Handle cancel error
  if (cancelError && cancellingOrderId) {
    console.error('Failed to cancel order:', cancelError);
    setCancellingOrderId(null);
    resetCancel();
  }

  const handleCancel = (orderId: string) => {
    // Can't cancel without contract address
    if (!contractAddress) return;

    // Find the order to get the closeId
    const order = orders?.find((o) => o.id === orderId);
    if (!order) return;

    const config = order.config as unknown as SerializedUniswapV3CloseOrderConfig;
    const closeId = BigInt(config.closeId);

    setCancellingOrderId(orderId);
    cancelOrder({
      contractAddress,
      chainId,
      closeId,
      orderId,
      positionId,
    });
  };

  // Check if a specific order is being cancelled
  const isOrderCancelling = (orderId: string) =>
    orderId === cancellingOrderId && (isCancelling || isWaitingForConfirmation);

  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-slate-200">Automation</h3>
        </div>
        {onCreateOrder && !isPositionClosed && (
          <button
            onClick={onCreateOrder}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-400 hover:text-blue-300 bg-blue-900/20 hover:bg-blue-900/30 border border-blue-700/50 rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Set Close Order
          </button>
        )}
      </div>

      {/* Content */}
      {isPositionClosed && !hasActiveOrders && terminalOrders.length === 0 ? (
        // Position is closed - show message
        <div className="text-center py-8">
          <p className="text-slate-400 mb-3">This position is closed.</p>
          <p className="text-slate-500 text-sm">
            Automation orders cannot be created for closed positions.
          </p>
        </div>
      ) : !hasContract ? (
        // No contract deployed yet - show empty state
        <div className="text-center py-8">
          <p className="text-slate-400 mb-3">No close orders set for this position.</p>
          <p className="text-slate-500 text-sm">
            Set a close order to automatically close your position when price reaches your target.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 py-4 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>Failed to load close orders</span>
        </div>
      ) : !hasActiveOrders && terminalOrders.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-slate-400 mb-3">No close orders set for this position.</p>
          <p className="text-slate-500 text-sm">
            Set a close order to automatically close your position when price reaches your target.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Active Orders */}
          {activeOrders.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-slate-400">Active Orders</h4>
              {activeOrders.map((order) => (
                <CloseOrderCard
                  key={order.id}
                  order={order}
                  quoteTokenSymbol={quoteTokenSymbol}
                  quoteTokenDecimals={quoteTokenDecimals}
                  baseTokenSymbol={baseTokenSymbol}
                  baseTokenDecimals={baseTokenDecimals}
                  baseTokenAddress={baseTokenAddress}
                  quoteTokenAddress={quoteTokenAddress}
                  onCancel={handleCancel}
                  isCancelling={isOrderCancelling(order.id)}
                />
              ))}
            </div>
          )}

          {/* Terminal Orders (collapsed/summary) */}
          {terminalOrders.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-slate-500">
                Past Orders ({terminalOrders.length})
              </h4>
              <div className="space-y-2">
                {terminalOrders.slice(0, 3).map((order) => (
                  <CloseOrderCard
                    key={order.id}
                    order={order}
                    quoteTokenSymbol={quoteTokenSymbol}
                    quoteTokenDecimals={quoteTokenDecimals}
                    baseTokenSymbol={baseTokenSymbol}
                    baseTokenDecimals={baseTokenDecimals}
                    baseTokenAddress={baseTokenAddress}
                    quoteTokenAddress={quoteTokenAddress}
                  />
                ))}
              </div>
              {terminalOrders.length > 3 && (
                <p className="text-xs text-slate-500 text-center">
                  +{terminalOrders.length - 3} more past orders
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Activity Log - always show if we have position ID */}
      <AutomationLogList
        positionId={positionId}
        chainId={chainId}
        hasActiveOrders={hasActiveOrders}
      />
    </div>
  );
}
