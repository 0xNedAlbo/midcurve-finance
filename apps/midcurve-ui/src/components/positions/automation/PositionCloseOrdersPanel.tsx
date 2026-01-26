/**
 * Position Close Orders Panel
 *
 * Panel for position detail page showing:
 * - Active close orders for this position
 * - "Set Close Order" button to create new ones
 * - Loading and error states
 */

import { useState } from 'react';
import { Plus, AlertCircle, AlertTriangle, Loader2, Shield } from 'lucide-react';
import type { Address } from 'viem';
import { useAccount } from 'wagmi';
import type { SerializedUniswapV3CloseOrderConfig, TriggerMode } from '@midcurve/api-shared';
import { useCloseOrders, useCancelCloseOrder, type OrderType } from '@/hooks/automation';
import { CloseOrderCard, type WalletIssue } from './CloseOrderCard';
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
   * NFT ID of the position (for position-scoped API)
   */
  nftId: string;

  /**
   * Automation contract address on this chain
   * Optional - when undefined, shows empty state but allows creating orders
   */
  contractAddress?: Address;

  /**
   * Position owner address - used to check if connected wallet can cancel orders
   */
  positionOwner?: Address;

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
  nftId,
  contractAddress,
  positionOwner,
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

  // Wallet connection state
  const { address: connectedAddress, isConnected, chainId: connectedChainId } = useAccount();

  // Check wallet connection issues for cancel functionality
  const isWrongNetwork = isConnected && connectedChainId !== chainId;
  const isWrongAccount = !!(
    isConnected &&
    connectedAddress &&
    positionOwner &&
    connectedAddress.toLowerCase() !== positionOwner.toLowerCase()
  );

  // Determine wallet issue for UI feedback
  const walletIssue: WalletIssue | undefined = !isConnected
    ? 'not-connected'
    : isWrongNetwork
      ? 'wrong-network'
      : isWrongAccount
        ? 'wrong-account'
        : undefined;

  // Can cancel orders only if wallet is properly connected
  const canCancelOrders = isConnected && !isWrongNetwork && !isWrongAccount;

  // Whether contract exists - determines if we can fetch orders
  const hasContract = !!contractAddress;

  // Fetch close orders for this position (only if contract exists)
  const { data: orders, isLoading, error, refetch } = useCloseOrders(
    { chainId, nftId, polling: true },
    { enabled: !!positionId && hasContract }
  );

  // Cancel hook - fetches ABI internally
  const {
    cancelOrder,
    isCancelling,
    isWaitingForConfirmation,
    isSuccess: isCancelSuccess,
    error: cancelError,
    isTimedOut,
    forceCancelled,
    reset: resetCancel,
  } = useCancelCloseOrder(chainId, nftId);

  // Filter to show active orders first, then terminal ones
  const activeOrders = orders?.filter((o) => !isCloseOrderTerminal(o.status)) ?? [];
  const terminalOrders = orders?.filter((o) => isCloseOrderTerminal(o.status)) ?? [];

  // Has any active (non-terminal) orders
  const hasActiveOrders = activeOrders.length > 0;

  // Handle cancel success (including force-cancelled)
  if (isCancelSuccess && cancellingOrderId) {
    setCancellingOrderId(null);
    // Don't reset if force-cancelled - we want to show the warning
    if (!forceCancelled) {
      resetCancel();
    }
    refetch();
  }

  const handleCancel = (orderId: string) => {
    // Can't cancel without contract address
    if (!contractAddress) return;

    // Find the order to get the closeOrderHash and triggerMode
    const order = orders?.find((o) => o.id === orderId);
    if (!order) return;

    const config = order.config as unknown as SerializedUniswapV3CloseOrderConfig;
    const triggerMode = config.triggerMode ?? 'LOWER';

    if (!order.closeOrderHash) {
      console.error('Order missing closeOrderHash');
      return;
    }

    // Map triggerMode to orderType (V1.0 tick-based interface)
    // When isToken0Quote=true, the order type is inverted because tick direction is opposite to user price direction
    const isToken0Quote = BigInt(quoteTokenAddress) < BigInt(baseTokenAddress);
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

    setCancellingOrderId(orderId);
    cancelOrder({
      orderType,
      closeOrderHash: order.closeOrderHash,
      positionId,
    });
  };

  // Check if a specific order is being cancelled (not if already force-cancelled)
  const isOrderCancelling = (orderId: string) =>
    orderId === cancellingOrderId && (isCancelling || isWaitingForConfirmation) && !forceCancelled;

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

      {/* Warning: Order was force-cancelled due to timeout/failure */}
      {forceCancelled && (
        <div className="flex items-start gap-2 p-3 mb-4 bg-amber-900/30 border border-amber-700/50 rounded-lg text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span>
              Order cancelled in system.{' '}
              {isTimedOut ? 'The transaction timed out - ' : 'The transaction failed - '}
              if the order is still active on-chain, it will be ignored by automation.
            </span>
            <button
              onClick={resetCancel}
              className="ml-2 text-amber-300 hover:text-amber-200 underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Error: Cancel failed completely */}
      {cancelError && !forceCancelled && (
        <div className="flex items-start gap-2 p-3 mb-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span>Failed to cancel order: {cancelError.message}</span>
            <button
              onClick={resetCancel}
              className="ml-2 text-red-300 hover:text-red-200 underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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
                  onCancel={canCancelOrders ? handleCancel : undefined}
                  isCancelling={isOrderCancelling(order.id)}
                  walletIssue={walletIssue}
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
