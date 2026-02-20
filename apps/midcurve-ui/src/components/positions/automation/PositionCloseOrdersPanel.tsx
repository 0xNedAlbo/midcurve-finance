/**
 * Position Close Orders Panel
 *
 * Panel for position detail page showing:
 * - Active close orders for this position
 * - Loading and error states
 */

import { AlertCircle, Loader2, Settings2, Shield } from 'lucide-react';
import type { Address } from 'viem';
import { useCloseOrders } from '@/hooks/automation';
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
   * NFT ID of the position (for position-scoped API)
   */
  nftId: string;

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
   * Whether the position is closed (liquidity = 0)
   */
  isPositionClosed?: boolean;

  /**
   * Callback to navigate to the Risk Triggers wizard for editing SL/TP orders
   */
  onEditOrders?: () => void;
}

export function PositionCloseOrdersPanel({
  positionId,
  chainId,
  nftId,
  contractAddress,
  quoteTokenSymbol,
  quoteTokenDecimals,
  baseTokenSymbol,
  baseTokenDecimals,
  baseTokenAddress,
  quoteTokenAddress,
  isPositionClosed = false,
  onEditOrders,
}: PositionCloseOrdersPanelProps) {
  // Whether contract exists - determines if we can fetch orders
  const hasContract = !!contractAddress;

  // Fetch close orders for this position (only if contract exists)
  const { data: orders, isLoading, error } = useCloseOrders(
    { chainId, nftId, polling: true },
    { enabled: !!positionId && hasContract }
  );

  // Filter to show active orders first, then terminal ones
  const activeOrders = orders?.filter((o) => !isCloseOrderTerminal(o.automationState)) ?? [];
  const terminalOrders = orders?.filter((o) => isCloseOrderTerminal(o.automationState)) ?? [];

  // Has any active (non-terminal) orders
  const hasActiveOrders = activeOrders.length > 0;

  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-slate-200">Automation</h3>
        </div>
        {onEditOrders && !isPositionClosed && (
          <button
            onClick={onEditOrders}
            className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
          >
            <Settings2 className="w-4 h-4" />
            Edit SL/TP Orders
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
