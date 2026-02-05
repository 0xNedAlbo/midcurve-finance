/**
 * Erc20TokenApprovalPrompt - Complete ERC-20 token approval flow component
 *
 * Encapsulates the entire approval flow including:
 * - Reading current allowance
 * - Real-time approval watching via WebSocket subscriptions
 * - Exact amount approval
 * - Infinite (max) approval
 * - User rejection handling (silently ignored)
 * - Transaction status display
 * - Error handling with retry
 */

'use client';

import { useCallback, useMemo } from 'react';
import { Circle, Check, Loader2, AlertCircle, ExternalLink, Copy } from 'lucide-react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { Address } from 'viem';
import { formatUnits, getAddress } from 'viem';
import { ERC20_ABI } from '@/config/tokens/erc20-abi';
import { useTokenApproval } from '@/hooks/positions/uniswapv3/wizard/useTokenApproval';
import { useWatchErc20TokenApproval } from '@/hooks/tokens/erc20/useWatchErc20TokenApproval';
import { buildTxUrl, truncateTxHash } from '@/lib/explorer-utils';

export type ApprovalStatus = 'pending' | 'waiting' | 'confirming' | 'success' | 'error';

export interface Erc20TokenApprovalPromptProps {
  /**
   * Token contract address
   */
  tokenAddress: Address | null;

  /**
   * Token symbol (e.g., "WETH", "USDC")
   */
  tokenSymbol: string;

  /**
   * Token decimals
   */
  tokenDecimals: number;

  /**
   * Required approval amount (in smallest unit)
   */
  requiredAmount: bigint;

  /**
   * Spender address (e.g., NonfungiblePositionManager)
   */
  spenderAddress: Address | null;

  /**
   * Chain ID
   */
  chainId: number | undefined;

  /**
   * Whether the component is enabled
   */
  enabled?: boolean;

  /**
   * Callback when approval status changes
   */
  onApprovalChange?: (isApproved: boolean) => void;
}

export interface UseErc20TokenApprovalPromptResult {
  /**
   * The rendered approval prompt element
   */
  element: React.ReactNode;

  /**
   * Whether the token is approved for the required amount
   */
  isApproved: boolean;

  /**
   * Current approval status
   */
  status: ApprovalStatus;

  /**
   * Any error that occurred (filtered - no user rejections)
   */
  error: string | null;

  /**
   * Cancel the approval watch subscription (calls DELETE endpoint)
   */
  cancel: () => Promise<void>;
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
 * Format token amount for display
 */
function formatTokenAmount(amount: bigint, decimals: number): string {
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  if (num < 1) return num.toPrecision(4);
  if (num < 1000) return num.toFixed(4).replace(/\.?0+$/, '');
  // Compact format for large numbers
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

/**
 * Complete ERC-20 token approval flow component
 *
 * @example
 * ```tsx
 * <Erc20TokenApprovalPrompt
 *   tokenAddress="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
 *   tokenSymbol="WETH"
 *   tokenDecimals={18}
 *   requiredAmount={BigInt('1000000000000000000')}
 *   spenderAddress="0x..."
 *   chainId={1}
 * />
 * ```
 */
export function useErc20TokenApprovalPrompt({
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  requiredAmount,
  spenderAddress,
  chainId,
  enabled = true,
  onApprovalChange,
}: Erc20TokenApprovalPromptProps): UseErc20TokenApprovalPromptResult {
  const { address: ownerAddress } = useAccount();

  // Token approval hook (for infinite approval via useTokenApproval)
  const approval = useTokenApproval({
    tokenAddress,
    ownerAddress: ownerAddress ?? null,
    requiredAmount,
    chainId,
    enabled: enabled && !!tokenAddress && !!ownerAddress && !!chainId && requiredAmount > 0n,
  });

  // Watch hook for real-time approval status updates
  const approvalWatch = useWatchErc20TokenApproval({
    tokenAddress,
    ownerAddress: ownerAddress ?? null,
    spenderAddress,
    chainId: chainId ?? 0,
    requiredAmount,
    enabled: enabled && !!tokenAddress && !!ownerAddress && !!spenderAddress && !!chainId && requiredAmount > 0n,
  });

  // Exact amount approval hooks
  const {
    writeContract: writeExactApproval,
    data: exactApprovalTxHash,
    isPending: isExactApproving,
    error: exactApprovalError,
    reset: resetExactApproval,
  } = useWriteContract();

  const { isLoading: isExactWaiting, error: exactReceiptError } = useWaitForTransactionReceipt({
    hash: exactApprovalTxHash,
    chainId,
  });

  // Combined approval status - prioritize watch hook (on-chain state) over local state
  // Local approval.isApproved is only used as fallback when watch hasn't loaded yet
  const isApproved = requiredAmount === 0n || approvalWatch.isApproved || (approval.isApproved && approvalWatch.allowance === undefined);

  // Filter user rejection errors
  const approvalErrorFiltered = isUserRejection(approval.approvalError) ? null : approval.approvalError;
  const exactErrorRaw = exactApprovalError || exactReceiptError;
  const exactErrorFiltered = isUserRejection(exactErrorRaw) ? null : exactErrorRaw;

  // Determine current status
  const status = useMemo((): ApprovalStatus => {
    if (requiredAmount === 0n || isApproved) return 'success';
    if (exactErrorFiltered || approvalErrorFiltered) return 'error';
    if (isExactWaiting || approval.isWaitingForConfirmation) return 'confirming';
    if (isExactApproving || approval.isApproving) return 'waiting';
    return 'pending';
  }, [requiredAmount, isApproved, exactErrorFiltered, approvalErrorFiltered, isExactWaiting, approval.isWaitingForConfirmation, isExactApproving, approval.isApproving]);

  // Combined error message
  const error = approvalErrorFiltered?.message || exactErrorFiltered?.message || null;

  // Transaction hash (prefer exact approval if available)
  const txHash = exactApprovalTxHash || approval.approvalTxHash;

  // Formatted amount for display
  const formattedAmount = formatTokenAmount(requiredAmount, tokenDecimals);

  // Handler for exact amount approval
  const handleExactApprove = useCallback(() => {
    if (!tokenAddress || !spenderAddress || !chainId) return;
    resetExactApproval();
    writeExactApproval({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [getAddress(spenderAddress), requiredAmount],
      chainId,
    });
  }, [tokenAddress, spenderAddress, chainId, requiredAmount, writeExactApproval, resetExactApproval]);

  // Handler for infinite approval
  const handleInfiniteApprove = useCallback(() => {
    if (!tokenAddress || !spenderAddress || !chainId) return;
    resetExactApproval();
    // Use the useTokenApproval hook which approves maxUint256
    approval.approve();
  }, [tokenAddress, spenderAddress, chainId, approval, resetExactApproval]);

  // Notify parent of approval changes
  useMemo(() => {
    onApprovalChange?.(isApproved);
  }, [isApproved, onApprovalChange]);

  const isActive = status === 'waiting' || status === 'confirming';
  const isError = status === 'error';
  const isSuccess = status === 'success';

  // Show buttons when pending OR when there's an error (for retry), but not when active
  const showButtons = (status === 'pending' || isError) && !isActive;

  const label = `Approve ${formattedAmount} ${tokenSymbol}`;

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
          {txHash && chainId && (
            <a
              href={buildTxUrl(chainId, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
            >
              {truncateTxHash(txHash)}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {showButtons && (
            <>
              <button
                onClick={handleInfiniteApprove}
                className="text-sm text-yellow-400 hover:text-yellow-300 underline decoration-dashed underline-offset-2 transition-colors cursor-pointer"
              >
                Infinite
              </button>
              <button
                onClick={handleExactApprove}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
              >
                Approve
              </button>
            </>
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
    isApproved,
    status,
    error,
    cancel: approvalWatch.cancel,
  };
}
