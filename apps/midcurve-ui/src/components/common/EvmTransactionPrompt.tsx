/**
 * EvmTransactionPrompt - Complete EVM transaction execution and status tracking component
 *
 * Encapsulates the entire transaction flow including:
 * - Transaction execution via provided execute function
 * - Real-time status tracking via backend subscriptions
 * - User rejection handling (silently ignored)
 * - Transaction status display with explorer links
 * - Error handling with retry
 */

'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
import { Circle, Check, Loader2, AlertCircle, ExternalLink, Copy } from 'lucide-react';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';
import { buildTxUrl, truncateTxHash } from '@/lib/explorer-utils';

export type TransactionStatus = 'idle' | 'pending' | 'waiting' | 'confirming' | 'success' | 'error';

export interface EvmTransactionPromptProps {
  /**
   * Label for the transaction (e.g., "Open Position", "Register Stop Loss")
   */
  label: string;

  /**
   * Button label for starting the transaction (default: "Start")
   */
  buttonLabel?: string;

  /**
   * Button label for retrying after error (default: "Retry")
   */
  retryButtonLabel?: string;

  /**
   * Chain ID for the transaction
   */
  chainId: number | undefined;

  /**
   * Whether the transaction is enabled/ready to execute
   */
  enabled?: boolean;

  /**
   * Whether to show the action button (Start/Retry)
   * Use this to control sequential transaction flow
   */
  showActionButton?: boolean;

  /**
   * Transaction hash if already submitted
   * Used when the parent component manages the transaction
   */
  txHash?: string;

  /**
   * Whether the transaction is currently being submitted (wallet popup open)
   */
  isSubmitting?: boolean;

  /**
   * Whether the transaction is waiting for confirmation
   */
  isWaitingForConfirmation?: boolean;

  /**
   * Whether the transaction completed successfully
   */
  isSuccess?: boolean;

  /**
   * Error from the transaction (will be filtered for user rejections)
   */
  error?: Error | null;

  /**
   * Function to execute when Start button is clicked
   */
  onExecute?: () => void;

  /**
   * Function to reset/retry the transaction
   */
  onReset?: () => void;

  /**
   * Callback when transaction status changes
   */
  onStatusChange?: (status: TransactionStatus) => void;

  /**
   * Target confirmations before marking complete (default: 1)
   */
  targetConfirmations?: number;
}

export interface UseEvmTransactionPromptResult {
  /**
   * The rendered transaction prompt element
   */
  element: React.ReactNode;

  /**
   * Current transaction status
   */
  status: TransactionStatus;

  /**
   * Whether the transaction completed successfully
   */
  isSuccess: boolean;

  /**
   * Whether tracking is complete (confirmations reached)
   */
  isComplete: boolean;

  /**
   * Any error that occurred (filtered - no user rejections)
   */
  error: string | null;
}

/**
 * Helper to check if error is user rejection (not a real error)
 */
function isUserRejection(error: Error | null | undefined): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() || '';
  return message.includes('user rejected') || message.includes('user denied');
}

/**
 * Complete EVM transaction execution and status tracking component
 *
 * @example
 * ```tsx
 * const { element, status, isSuccess } = useEvmTransactionPrompt({
 *   label: 'Open Position',
 *   chainId: 1,
 *   txHash: mint.txHash,
 *   isSubmitting: mint.isPending,
 *   isWaitingForConfirmation: mint.isWaitingForConfirmation,
 *   isSuccess: mint.isSuccess,
 *   error: mint.error,
 *   onExecute: () => mint.execute(),
 *   onReset: () => mint.reset(),
 *   showActionButton: currentPhase === 'mint',
 * });
 * ```
 */
export function useEvmTransactionPrompt({
  label,
  buttonLabel = 'Start',
  retryButtonLabel = 'Retry',
  chainId,
  enabled = true,
  showActionButton = true,
  txHash,
  isSubmitting = false,
  isWaitingForConfirmation = false,
  isSuccess: isSuccessProp = false,
  error: errorProp,
  onExecute,
  onReset,
  onStatusChange,
  targetConfirmations = 1,
}: EvmTransactionPromptProps): UseEvmTransactionPromptResult {
  const [internalTxHash, setInternalTxHash] = useState<string | null>(null);

  // Use the provided txHash or internal one
  const effectiveTxHash = txHash || internalTxHash;

  // Watch transaction status via backend subscription
  const txWatch = useWatchTransactionStatus({
    txHash: effectiveTxHash ?? null,
    chainId: chainId ?? 1,
    targetConfirmations,
    enabled: enabled && !!effectiveTxHash && !!chainId,
  });

  // Filter user rejection errors
  const errorFiltered = isUserRejection(errorProp) ? null : errorProp;

  // Determine current status
  const status = useMemo((): TransactionStatus => {
    // Check for success first (from prop or watch)
    if (isSuccessProp || txWatch.status === 'success') return 'success';

    // Check for errors
    if (errorFiltered) return 'error';
    if (txWatch.status === 'reverted') return 'error';

    // Check for confirming state
    if (isWaitingForConfirmation || txWatch.status === 'pending') return 'confirming';

    // Check for waiting state (wallet popup)
    if (isSubmitting) return 'waiting';

    // Check if we have a tx hash but still pending
    if (effectiveTxHash && txWatch.status === 'not_found') return 'confirming';

    return 'idle';
  }, [
    isSuccessProp,
    txWatch.status,
    errorFiltered,
    isWaitingForConfirmation,
    isSubmitting,
    effectiveTxHash,
  ]);

  // Notify parent of status changes
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // Combined error message
  const error = errorFiltered?.message || (txWatch.status === 'reverted' ? 'Transaction reverted' : null);

  // Success state
  const isSuccess = status === 'success';
  const isComplete = isSuccess && txWatch.isComplete;

  // Handler for execute
  const handleExecute = useCallback(() => {
    if (!enabled) return;
    onExecute?.();
  }, [enabled, onExecute]);

  // Handler for retry
  const handleRetry = useCallback(() => {
    setInternalTxHash(null);
    onReset?.();
  }, [onReset]);

  const isActive = status === 'waiting' || status === 'confirming';
  const isError = status === 'error';
  const isIdle = status === 'idle';

  // Show buttons when idle OR when there's an error (for retry), but not when active
  const showButtons = showActionButton && (isIdle || isError) && !isActive;

  const element = (
    <div
      className={`py-3 px-4 rounded-lg transition-colors ${
        isError
          ? 'bg-red-500/10 border border-red-500/30'
          : isSuccess
          ? 'bg-green-500/10 border border-green-500/20'
          : isActive
          ? 'bg-blue-500/10 border border-blue-500/20'
          : 'bg-slate-700/30 border border-slate-600/20'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Status Icon */}
          {status === 'idle' && <Circle className="w-5 h-5 text-slate-500" />}
          {status === 'pending' && <Circle className="w-5 h-5 text-slate-500" />}
          {status === 'waiting' && <Circle className="w-5 h-5 text-blue-400" />}
          {status === 'confirming' && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
          {status === 'success' && <Check className="w-5 h-5 text-green-400" />}
          {status === 'error' && <AlertCircle className="w-5 h-5 text-red-400" />}

          {/* Label */}
          <span
            className={
              isSuccess
                ? 'text-slate-400'
                : isError
                ? 'text-red-300'
                : 'text-white'
            }
          >
            {label}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {effectiveTxHash && chainId && (
            <a
              href={buildTxUrl(chainId, effectiveTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
            >
              {truncateTxHash(effectiveTxHash)}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {showButtons && (
            <button
              onClick={isError ? handleRetry : handleExecute}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
            >
              {isError ? retryButtonLabel : buttonLabel}
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {isError && error && (
        <div className="mt-2 pl-8 flex gap-2">
          <div className="flex-1 max-h-20 overflow-y-auto text-sm text-red-400/80 bg-red-950/30 rounded p-2">
            {error}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(error)}
            className="flex-shrink-0 p-1.5 text-red-400/60 hover:text-red-400 transition-colors cursor-pointer"
            title="Copy error to clipboard"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );

  return {
    element,
    status,
    isSuccess,
    isComplete,
    error,
  };
}
