/**
 * Fund Autowallet Modal
 *
 * Modal for funding the automation wallet with ETH (or native token).
 * User sends ETH directly to the autowallet address via their connected wallet.
 */

import { useState } from 'react';
import { X, Loader2, ExternalLink, Copy, Check } from 'lucide-react';
import { parseUnits, formatUnits } from 'viem';
import { useSendTransaction, useWaitForTransactionReceipt, useBalance, useAccount } from 'wagmi';
import { getChainMetadataByChainId, getChainSlugByChainId } from '@/config/chains';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { useQueryClient } from '@tanstack/react-query';
import { autowalletQueryKey } from '@/hooks/automation';

interface FundAutowalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  autowalletAddress: string;
  chainId: number;
}

export function FundAutowalletModal({
  isOpen,
  onClose,
  autowalletAddress,
  chainId,
}: FundAutowalletModalProps) {
  const [amount, setAmount] = useState('');
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const chainMetadata = getChainMetadataByChainId(chainId);
  const symbol = chainId === 56 ? 'BNB' : chainId === 137 ? 'MATIC' : 'ETH';
  const { chainId: connectedChainId } = useAccount();
  const chainSlug = getChainSlugByChainId(chainId);
  const isWrongNetwork = connectedChainId !== chainId;

  // Get user's balance on this chain
  const { data: balance } = useBalance({
    chainId,
  });

  // Send transaction hook
  const { sendTransaction, isPending: isSending, data: txHash } = useSendTransaction();

  // Wait for transaction receipt
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const handleCopyAddress = async () => {
    await navigator.clipboard.writeText(autowalletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFund = () => {
    if (!amount || parseFloat(amount) <= 0) return;

    const value = parseUnits(amount, 18);

    sendTransaction({
      to: autowalletAddress as `0x${string}`,
      value,
      chainId,
    });
  };

  const handleClose = () => {
    if (isConfirmed) {
      // Invalidate autowallet query to refresh balances
      queryClient.invalidateQueries({ queryKey: autowalletQueryKey });
      // Invalidate wagmi balance queries for the autowallet address
      // This ensures the AutowalletBalanceCard components refetch their balances
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
    setAmount('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-slate-900 rounded-xl border border-slate-700/50 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <h2 className="text-lg font-semibold text-white">
            Fund Automation Wallet
          </h2>
          <button
            onClick={handleClose}
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
              Funding on <span className="text-white font-medium">{chainMetadata?.shortName}</span>
            </p>
          </div>

          {/* Autowallet address */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Automation Wallet Address
            </label>
            <div className="flex items-center gap-2 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <code className="flex-1 text-sm text-slate-200 font-mono truncate">
                {autowalletAddress}
              </code>
              <button
                onClick={handleCopyAddress}
                className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Network switch prompt */}
          {chainSlug && (
            <EvmSwitchNetworkPrompt chain={chainSlug} isWrongNetwork={isWrongNetwork} />
          )}

          {/* Amount input */}
          {!isConfirmed && (
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
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  disabled={isSending || isConfirming}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                  {symbol}
                </div>
              </div>
              {balance && (
                <p className="mt-1 text-xs text-slate-500">
                  Balance: {parseFloat(formatUnits(balance.value, 18)).toFixed(4)} {symbol}
                </p>
              )}
            </div>
          )}

          {/* Transaction status */}
          {txHash && (
            <div className="p-3 bg-slate-800/50 rounded-lg">
              {isConfirming && (
                <div className="flex items-center gap-2 text-sm text-yellow-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Confirming transaction...</span>
                </div>
              )}
              {isConfirmed && (
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <Check className="w-4 h-4" />
                  <span>Transaction confirmed!</span>
                </div>
              )}
              <a
                href={`${chainMetadata?.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 mt-2 text-xs text-blue-400 hover:text-blue-300"
              >
                View on Explorer
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700/50">
          {isConfirmed ? (
            <button
              onClick={handleClose}
              className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
            >
              Done
            </button>
          ) : (
            <button
              onClick={handleFund}
              disabled={!amount || parseFloat(amount) <= 0 || isSending || isConfirming || isWrongNetwork}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSending || isConfirming ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isSending ? 'Sending...' : 'Confirming...'}
                </span>
              ) : (
                `Send ${amount || '0'} ${symbol}`
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
