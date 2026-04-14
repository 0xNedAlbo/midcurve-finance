/**
 * Erc20TokenApprovalPrompt - Complete ERC-20 token approval flow component
 *
 * Encapsulates the entire approval flow including:
 * - Monitoring current allowance via backend subscription
 * - Exact amount approval
 * - Infinite (max) approval
 * - User rejection handling (silently ignored)
 * - Transaction confirmation tracking via backend subscription
 * - Error handling with retry
 *
 * Uses backend subscription hooks for all blockchain reads:
 * - useWatchErc20TokenApproval for allowance monitoring
 * - useWatchTransactionStatus for tx confirmation tracking
 */

'use client';

import { useCallback, useMemo } from 'react';
import { Circle, Check, Loader2, AlertCircle, ExternalLink, Copy } from 'lucide-react';
import { useAccount, useWriteContract } from 'wagmi';
import type { Address } from 'viem';
import { getAddress, maxUint256 } from 'viem';
import { ERC20_ABI } from '@/config/tokens/erc20-abi';
import { buildTxUrl, truncateTxHash } from '@/lib/explorer-utils';
import { useWatchErc20TokenApproval } from '@/hooks/tokens/erc20/useWatchErc20TokenApproval';
import { useWatchTransactionStatus } from '@/hooks/transactions/evm/useWatchTransactionStatus';

export type ApprovalStatus = 'pending' | 'waiting' | 'confirming' | 'success' | 'error';

export interface Erc20TokenApprovalPromptProps {
  tokenAddress: Address | null;
  tokenSymbol: string;
  tokenDecimals: number;
  requiredAmount: bigint;
  spenderAddress: Address | null;
  chainId: number | undefined;
  enabled?: boolean;
  onApprovalChange?: (isApproved: boolean) => void;
}

export interface UseErc20TokenApprovalPromptResult {
  element: React.ReactNode;
  isApproved: boolean;
  /** Current allowance from backend subscription (undefined while loading) */
  allowance: bigint | undefined;
  status: ApprovalStatus;
  error: string | null;
}

function isUserRejection(error: Error | null | undefined): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() || '';
  return message.includes('user rejected') || message.includes('user denied');
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  // Scale down from smallest unit to human-readable
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;

  if (amount === 0n) return '0';

  // For very small amounts, show "<0.0001"
  const threshold = divisor / 10000n; // 0.0001 in token units
  if (amount > 0n && amount < threshold) return '<0.0001';

  // Build a decimal string from bigint parts
  const remainderStr = remainder.toString().padStart(decimals, '0');
  const num = parseFloat(`${whole}.${remainderStr}`);

  if (num < 1) return num.toPrecision(4);
  if (num < 1000) return num.toFixed(4).replace(/\.?0+$/, '');
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

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

  const canCheck = enabled && !!tokenAddress && !!ownerAddress && !!spenderAddress && !!chainId;

  // Watch allowance via backend subscription
  const {
    allowance,
    isApproved: approvalSufficient,
    refresh: refreshApproval,
    error: approvalWatchError,
  } = useWatchErc20TokenApproval({
    tokenAddress: tokenAddress ?? null,
    ownerAddress: ownerAddress ?? null,
    spenderAddress: spenderAddress ?? null,
    chainId: chainId ?? 0,
    requiredAmount,
    enabled: canCheck && requiredAmount > 0n,
  });

  const isApproved = requiredAmount === 0n || approvalSufficient;

  // Single writeContract instance for both exact and infinite approvals
  const {
    writeContract,
    data: txHash,
    isPending: isSigning,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Watch tx confirmation via backend subscription
  const txWatch = useWatchTransactionStatus({
    txHash: txHash ?? null,
    chainId: chainId ?? 0,
    targetConfirmations: 1,
    enabled: !!txHash,
    onConfirmed: () => refreshApproval(),
  });

  const isConfirming = !!txHash && txWatch.status !== 'success' && txWatch.status !== 'reverted' && !txWatch.error;
  const receiptSuccess = txWatch.status === 'success';
  const receiptError = txWatch.status === 'reverted' ? new Error('Transaction reverted') : null;

  // Filter user rejection errors
  const filteredWriteError = isUserRejection(writeError) ? null : writeError;
  const filteredReceiptError = receiptError;
  const errorObj = filteredWriteError || filteredReceiptError || (approvalWatchError ? new Error(approvalWatchError) : null);
  const error = errorObj?.message || null;

  const status = useMemo((): ApprovalStatus => {
    if (requiredAmount === 0n || isApproved) return 'success';
    if (errorObj) return 'error';
    // Bridge the gap: receipt confirmed but allowance poll hasn't caught up yet
    if (isConfirming || (receiptSuccess && !isApproved)) return 'confirming';
    if (isSigning) return 'waiting';
    return 'pending';
  }, [requiredAmount, isApproved, errorObj, isConfirming, receiptSuccess, isSigning]);

  const handleExactApprove = useCallback(() => {
    if (!tokenAddress || !spenderAddress || !chainId) return;
    resetWrite();
    writeContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [getAddress(spenderAddress), requiredAmount],
      chainId,
    });
  }, [tokenAddress, spenderAddress, chainId, requiredAmount, writeContract, resetWrite]);

  const handleInfiniteApprove = useCallback(() => {
    if (!tokenAddress || !spenderAddress || !chainId) return;
    resetWrite();
    writeContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [getAddress(spenderAddress), maxUint256],
      chainId,
    });
  }, [tokenAddress, spenderAddress, chainId, writeContract, resetWrite]);

  // Notify parent of approval changes
  useMemo(() => {
    onApprovalChange?.(isApproved);
  }, [isApproved, onApprovalChange]);

  const isActive = status === 'waiting' || status === 'confirming';
  const isError = status === 'error';
  const isSuccess = status === 'success';
  const showButtons = (status === 'pending' || isError) && !isActive;
  const formattedAmount = formatTokenAmount(requiredAmount, tokenDecimals);
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
          {status === 'pending' && <Circle className="w-5 h-5 text-slate-500" />}
          {status === 'waiting' && <Circle className="w-5 h-5 text-blue-400" />}
          {status === 'confirming' && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
          {status === 'success' && <Check className="w-5 h-5 text-green-400" />}
          {status === 'error' && <AlertCircle className="w-5 h-5 text-red-400" />}

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
    allowance,
    status,
    error,
  };
}
