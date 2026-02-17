/**
 * Close Order Card
 *
 * Displays a single close order with:
 * - Trigger type (Lower/Upper)
 * - Trigger price (from triggerTick)
 * - Status badge
 * - Expiration date
 */

import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import type { SerializedCloseOrder, TriggerMode } from '@midcurve/api-shared';
import { CloseOrderStatusBadge } from './CloseOrderStatusBadge';
import { formatTriggerPriceFromTick, type TokenConfig } from './order-button-utils';

interface CloseOrderCardProps {
  /**
   * The close order data
   */
  order: SerializedCloseOrder;

  /**
   * Quote token symbol for display
   */
  quoteTokenSymbol: string;

  /**
   * Quote token decimals for formatting
   */
  quoteTokenDecimals: number;

  /**
   * Base token symbol for display
   */
  baseTokenSymbol: string;

  /**
   * Base token decimals for formatting
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
}

/**
 * Get icon for trigger mode
 */
function getTriggerIcon(mode: TriggerMode) {
  switch (mode) {
    case 'LOWER':
      return <TrendingDown className="w-4 h-4 text-red-400" />;
    case 'UPPER':
      return <TrendingUp className="w-4 h-4 text-green-400" />;
    default:
      return null;
  }
}

/**
 * Get label for trigger mode
 */
function getTriggerLabel(mode: TriggerMode): string {
  switch (mode) {
    case 'LOWER':
      return 'Stop-Loss';
    case 'UPPER':
      return 'Take-Profit';
    default:
      return 'Unknown';
  }
}

export function CloseOrderCard({
  order,
  quoteTokenSymbol,
  quoteTokenDecimals,
  baseTokenDecimals,
  baseTokenAddress,
  quoteTokenAddress,
}: CloseOrderCardProps) {
  const triggerMode = order.triggerMode;

  // Build token config for price formatting
  const tokenConfig: TokenConfig = {
    baseTokenAddress,
    quoteTokenAddress,
    baseTokenDecimals,
    quoteTokenDecimals,
    baseTokenSymbol: '',
    quoteTokenSymbol,
  };

  // Format trigger price from tick
  const priceDisplay = formatTriggerPriceFromTick(order.triggerTick, tokenConfig);

  // Format expiration — null or epoch 0 means "no expiry"
  const parsedExpiry = order.validUntil ? new Date(order.validUntil) : null;
  const expiresAt = parsedExpiry && parsedExpiry.getTime() > 0 ? parsedExpiry : null;
  const isExpiringSoon = expiresAt && expiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000; // 7 days

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
      {/* Header Row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {getTriggerIcon(triggerMode)}
          <span className="font-medium text-slate-200">{getTriggerLabel(triggerMode)}</span>
        </div>
        <CloseOrderStatusBadge status={order.status} size="sm" />
      </div>

      {/* Trigger Price */}
      <div className="space-y-2 mb-3">
        {triggerMode === 'LOWER' && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Lower trigger:</span>
            <span className="text-red-400 font-mono">
              {priceDisplay} {quoteTokenSymbol}
            </span>
          </div>
        )}
        {triggerMode === 'UPPER' && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Upper trigger:</span>
            <span className="text-green-400 font-mono">
              {priceDisplay} {quoteTokenSymbol}
            </span>
          </div>
        )}
      </div>

      {/* Details Row */}
      <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
        <div className="flex items-center gap-1">
          {isExpiringSoon && <AlertTriangle className="w-3 h-3 text-amber-400" />}
          <span className={isExpiringSoon ? 'text-amber-400' : ''}>
            Expires: {expiresAt ? expiresAt.toLocaleDateString() : 'Never'}
          </span>
        </div>
        {order.slippageBps != null && (
          <span>Slippage: {(order.slippageBps / 100).toFixed(1)}%</span>
        )}
      </div>

    </div>
  );
}
