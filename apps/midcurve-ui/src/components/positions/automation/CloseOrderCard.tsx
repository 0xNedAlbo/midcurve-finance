/**
 * Close Order Card
 *
 * Displays a single close order with:
 * - Trigger type (Lower/Upper/Both)
 * - Trigger price(s)
 * - Status badge
 * - Expiration date
 * - Cancel button (if cancellable)
 */

import { X, AlertTriangle, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import type { SerializedCloseOrder, TriggerMode } from '@midcurve/api-shared';
import { pricePerToken0InToken1, pricePerToken1InToken0 } from '@midcurve/shared';
import { CloseOrderStatusBadge, canCancelCloseOrder } from './CloseOrderStatusBadge';
import { formatCompactValue } from '@/lib/fraction-format';

/**
 * Type of wallet issue preventing cancel action
 */
export type WalletIssue = 'not-connected' | 'wrong-network' | 'wrong-account';

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

  /**
   * Callback when cancel is clicked
   */
  onCancel?: (orderId: string) => void;

  /**
   * Whether cancel is in progress
   */
  isCancelling?: boolean;

  /**
   * Wallet issue preventing cancel action
   * When set, shows a hint instead of the cancel button
   */
  walletIssue?: WalletIssue;
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

/**
 * Format sqrtPriceX96 to human-readable price using proper token ordering
 */
function formatTriggerPrice(
  sqrtPriceX96: string | undefined,
  baseTokenAddress: string,
  quoteTokenAddress: string,
  baseTokenDecimals: number,
  quoteTokenDecimals: number
): string {
  if (!sqrtPriceX96 || sqrtPriceX96 === '0') return '-';

  try {
    const sqrtPrice = BigInt(sqrtPriceX96);
    const baseIsToken0 = BigInt(baseTokenAddress) < BigInt(quoteTokenAddress);

    // Get price in quote token raw units (quote per base)
    const price = baseIsToken0
      ? pricePerToken0InToken1(sqrtPrice, baseTokenDecimals)
      : pricePerToken1InToken0(sqrtPrice, baseTokenDecimals);

    return formatCompactValue(price, quoteTokenDecimals);
  } catch {
    return '-';
  }
}

export function CloseOrderCard({
  order,
  quoteTokenSymbol,
  quoteTokenDecimals,
  baseTokenDecimals,
  baseTokenAddress,
  quoteTokenAddress,
  onCancel,
  isCancelling = false,
  walletIssue,
}: CloseOrderCardProps) {
  const config = order.config as {
    triggerMode?: TriggerMode;
    sqrtPriceX96Lower?: string;
    sqrtPriceX96Upper?: string;
    validUntil?: string;
    slippageBps?: number;
  };

  const triggerMode = config.triggerMode ?? 'LOWER';
  const canCancel = canCancelCloseOrder(order.status);

  // Format expiration
  const expiresAt = config.validUntil ? new Date(config.validUntil) : null;
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

      {/* Trigger Prices */}
      <div className="space-y-2 mb-3">
        {triggerMode === 'LOWER' && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Lower trigger:</span>
            <span className="text-red-400 font-mono">
              {formatTriggerPrice(config.sqrtPriceX96Lower, baseTokenAddress, quoteTokenAddress, baseTokenDecimals, quoteTokenDecimals)} {quoteTokenSymbol}
            </span>
          </div>
        )}
        {triggerMode === 'UPPER' && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Upper trigger:</span>
            <span className="text-green-400 font-mono">
              {formatTriggerPrice(config.sqrtPriceX96Upper, baseTokenAddress, quoteTokenAddress, baseTokenDecimals, quoteTokenDecimals)} {quoteTokenSymbol}
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
        {config.slippageBps && (
          <span>Slippage: {(config.slippageBps / 100).toFixed(1)}%</span>
        )}
      </div>

      {/* Actions */}
      {canCancel && (
        walletIssue ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500">
            <Wallet className="w-3 h-3" />
            {walletIssue === 'not-connected' && 'Connect wallet to cancel'}
            {walletIssue === 'wrong-network' && 'Switch to correct network to cancel'}
            {walletIssue === 'wrong-account' && 'Connect position owner wallet to cancel'}
          </div>
        ) : onCancel && (
          <button
            onClick={() => onCancel(order.id)}
            disabled={isCancelling}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-3 h-3" />
            {isCancelling ? 'Cancelling...' : 'Cancel Order'}
          </button>
        )
      )}
    </div>
  );
}
