/**
 * Vault Close Orders Panel
 *
 * Panel for vault position detail page showing:
 * - Active close orders for this vault position
 * - Loading and error states
 * - Activity log
 */

import { AlertCircle, Loader2, Settings2, Shield } from 'lucide-react';
import type { Address } from 'viem';
import { useVaultCloseOrders } from '@/hooks/automation';
import { CloseOrderCard } from './CloseOrderCard';
import { isCloseOrderTerminal } from './CloseOrderStatusBadge';
import { AutomationLogList } from './AutomationLogList';

interface VaultCloseOrdersPanelProps {
  positionId: string;
  chainId: number;
  vaultAddress: string;
  ownerAddress: string;
  contractAddress?: Address;
  quoteTokenSymbol: string;
  quoteTokenDecimals: number;
  baseTokenSymbol: string;
  baseTokenDecimals: number;
  baseTokenAddress: string;
  quoteTokenAddress: string;
  isPositionClosed?: boolean;
  onEditOrders?: () => void;
}

export function VaultCloseOrdersPanel({
  positionId,
  chainId,
  vaultAddress,
  ownerAddress,
  contractAddress,
  quoteTokenSymbol,
  quoteTokenDecimals,
  baseTokenSymbol,
  baseTokenDecimals,
  baseTokenAddress,
  quoteTokenAddress,
  isPositionClosed = false,
  onEditOrders,
}: VaultCloseOrdersPanelProps) {
  const hasContract = !!contractAddress;

  const { data: orders, isLoading, error } = useVaultCloseOrders(
    { chainId, vaultAddress, ownerAddress, polling: true },
    { enabled: !!positionId && hasContract }
  );

  const activeOrders = orders?.filter((o) => !isCloseOrderTerminal(o.automationState)) ?? [];
  const terminalOrders = orders?.filter((o) => isCloseOrderTerminal(o.automationState)) ?? [];
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
        <div className="text-center py-8">
          <p className="text-slate-400 mb-3">This vault position is closed.</p>
          <p className="text-slate-500 text-sm">
            Automation orders cannot be created for closed positions.
          </p>
        </div>
      ) : !hasContract ? (
        <div className="text-center py-8">
          <p className="text-slate-400 mb-3">No close orders set for this vault position.</p>
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
          <p className="text-slate-400 mb-3">No close orders set for this vault position.</p>
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

          {/* Terminal Orders */}
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

      {/* Activity Log */}
      <AutomationLogList
        positionId={positionId}
        chainId={chainId}
        hasActiveOrders={hasActiveOrders}
      />
    </div>
  );
}
