/**
 * Refund Autowallet Modal
 *
 * Modal for requesting a refund of gas from the automation wallet.
 * The refund is processed by the signer service (server-side signing).
 */

import { useState, useEffect } from 'react';
import { X, Loader2, ExternalLink, Check, AlertCircle } from 'lucide-react';
import { parseUnits, formatUnits } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { getChainMetadataByChainId } from '@/config/chains';
import { useRefundAutowallet, useRefundStatus, autowalletQueryKey } from '@/hooks/automation';

interface RefundAutowalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  chainId: number;
  currentBalance: string; // in wei
  symbol: string;
  autowalletAddress: string;
}

export function RefundAutowalletModal({
  isOpen,
  onClose,
  chainId,
  currentBalance,
  symbol,
  autowalletAddress,
}: RefundAutowalletModalProps) {
  const [amount, setAmount] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [initialResponse, setInitialResponse] = useState<{
    operationStatus: string;
    txHash?: string;
  } | null>(null);
  const queryClient = useQueryClient();

  const chainMetadata = getChainMetadataByChainId(chainId);

  // Mutation for initiating refund
  const {
    mutate: requestRefund,
    isPending: isRequesting,
    error: requestError,
  } = useRefundAutowallet();

  // Only poll if initial response was 'pending' (not completed immediately)
  const shouldPoll = !!requestId && initialResponse?.operationStatus === 'pending';
  const { data: refundStatus } = useRefundStatus(requestId, shouldPoll);

  const maxBalance = formatUnits(BigInt(currentBalance), 18);

  // Use polled status if available, otherwise use initial response
  const currentStatus = refundStatus?.operationStatus ?? initialResponse?.operationStatus;
  const currentTxHash = refundStatus?.txHash ?? initialResponse?.txHash;

  const isComplete = currentStatus === 'completed';
  const isFailed = currentStatus === 'failed';
  const isProcessing = !!requestId && !isComplete && !isFailed;

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAmount('');
      setRequestId(null);
      setInitialResponse(null);
    }
  }, [isOpen]);

  // Invalidate balance queries when refund completes
  useEffect(() => {
    if (isComplete) {
      // Invalidate autowallet query
      queryClient.invalidateQueries({ queryKey: autowalletQueryKey });
      // Invalidate wagmi balance queries for the autowallet address
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'balance' &&
          typeof query.queryKey[1] === 'object' &&
          query.queryKey[1] !== null &&
          'address' in query.queryKey[1] &&
          (query.queryKey[1] as { address?: string }).address?.toLowerCase() ===
            autowalletAddress.toLowerCase(),
      });
    }
  }, [isComplete, autowalletAddress, queryClient]);

  const handleRefund = () => {
    if (!amount || parseFloat(amount) <= 0) return;

    const value = parseUnits(amount, 18);

    requestRefund(
      {
        chainId,
        amount: value.toString(),
      },
      {
        onSuccess: (data) => {
          setRequestId(data.requestId);
          // Store the initial response - if already completed, no need to poll
          setInitialResponse({
            operationStatus: data.operationStatus,
            txHash: data.txHash,
          });
        },
      }
    );
  };

  const handleSetMax = () => {
    // Leave a small amount for potential gas
    const maxWithBuffer = BigInt(currentBalance) - parseUnits('0.001', 18);
    if (maxWithBuffer > 0n) {
      setAmount(formatUnits(maxWithBuffer, 18));
    } else {
      setAmount(maxBalance);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-slate-900 rounded-xl border border-slate-700/50 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <h2 className="text-lg font-semibold text-white">
            Request Refund
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Chain info */}
          <div className="p-3 bg-slate-800/50 rounded-lg">
            <p className="text-sm text-slate-400">
              Refunding from <span className="text-white font-medium">{chainMetadata?.shortName}</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Available: {parseFloat(maxBalance).toFixed(6)} {symbol}
            </p>
          </div>

          {/* Destination */}
          <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
            <p className="text-sm text-slate-300">
              Refunds are sent to your primary wallet address.
            </p>
          </div>

          {/* Amount input */}
          {!isComplete && !isProcessing && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Amount
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  step="0.01"
                  min="0"
                  max={maxBalance}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  disabled={isRequesting}
                />
                <button
                  onClick={handleSetMax}
                  className="absolute right-12 top-1/2 -translate-y-1/2 text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                >
                  Max
                </button>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                  {symbol}
                </div>
              </div>
            </div>
          )}

          {/* Processing status */}
          {isProcessing && (
            <div className="p-4 bg-slate-800/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-yellow-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {refundStatus?.operationStatus === 'signing'
                    ? 'Signing transaction...'
                    : refundStatus?.operationStatus === 'broadcasting'
                    ? 'Broadcasting transaction...'
                    : 'Processing refund...'}
                </span>
              </div>
            </div>
          )}

          {/* Success */}
          {isComplete && (
            <div className="p-4 bg-green-900/20 rounded-lg border border-green-700/50">
              <div className="flex items-center gap-2 text-sm text-green-400">
                <Check className="w-4 h-4" />
                <span>Refund completed!</span>
              </div>
              {currentTxHash && (
                <a
                  href={`${chainMetadata?.explorer}/tx/${currentTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 mt-2 text-xs text-blue-400 hover:text-blue-300"
                >
                  View on Explorer
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {/* Error */}
          {(isFailed || requestError) && (
            <div className="p-4 bg-red-900/20 rounded-lg border border-red-700/50">
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="w-4 h-4" />
                <span>
                  {refundStatus?.operationError ||
                    (requestError instanceof Error ? requestError.message : 'Refund failed')}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700/50">
          {isComplete ? (
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
            >
              Done
            </button>
          ) : (
            <button
              onClick={handleRefund}
              disabled={
                !amount ||
                parseFloat(amount) <= 0 ||
                parseFloat(amount) > parseFloat(maxBalance) ||
                isRequesting ||
                isProcessing
              }
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isRequesting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Requesting...
                </span>
              ) : (
                `Request Refund of ${amount || '0'} ${symbol}`
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
