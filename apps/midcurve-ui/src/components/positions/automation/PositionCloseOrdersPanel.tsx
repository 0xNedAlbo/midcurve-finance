/**
 * Position Close Orders Panel
 *
 * Panel for position detail page showing:
 * - Active close orders for this position
 * - "Set Close Order" button to create new ones
 * - Loading and error states
 */

import { Plus, AlertCircle, Loader2, Shield } from 'lucide-react';
import { useCloseOrders } from '@/hooks/automation';
import { useCancelCloseOrder } from '@/hooks/automation';
import { CloseOrderCard } from './CloseOrderCard';
import { isCloseOrderTerminal } from './CloseOrderStatusBadge';

interface PositionCloseOrdersPanelProps {
  /**
   * Position ID to fetch orders for
   */
  positionId: string;

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
   * Callback to open the create order modal
   */
  onCreateOrder?: () => void;
}

export function PositionCloseOrdersPanel({
  positionId,
  quoteTokenSymbol,
  quoteTokenDecimals,
  baseTokenSymbol,
  baseTokenDecimals,
  onCreateOrder,
}: PositionCloseOrdersPanelProps) {
  // Fetch close orders for this position
  const { data: orders, isLoading, error, refetch } = useCloseOrders(
    { positionId, polling: true },
    { enabled: !!positionId }
  );

  // Cancel mutation
  const cancelMutation = useCancelCloseOrder();

  // Filter to show active orders first, then terminal ones
  const activeOrders = orders?.filter((o) => !isCloseOrderTerminal(o.status)) ?? [];
  const terminalOrders = orders?.filter((o) => isCloseOrderTerminal(o.status)) ?? [];

  // Has any active (non-terminal) orders
  const hasActiveOrders = activeOrders.length > 0;

  const handleCancel = async (orderId: string) => {
    try {
      await cancelMutation.mutateAsync({ orderId, positionId });
      refetch();
    } catch (err) {
      console.error('Failed to cancel order:', err);
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-slate-200">Automation</h3>
        </div>
        {onCreateOrder && (
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
      {isLoading ? (
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
                  onCancel={handleCancel}
                  isCancelling={cancelMutation.isPending}
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
    </div>
  );
}
