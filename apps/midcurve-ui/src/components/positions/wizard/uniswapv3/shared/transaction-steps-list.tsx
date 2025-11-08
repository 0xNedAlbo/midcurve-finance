'use client';

import { Loader2, Check, Circle, ExternalLink, AlertTriangle } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import type { Address } from 'viem';
import type { EvmChainSlug } from '@/config/chains';
import { formatCompactValue } from '@/lib/fraction-format';
import type { UseTokenApprovalResult } from '@/hooks/positions/uniswapv3/wizard/useTokenApproval';
import type { UseMintPositionResult } from '@/hooks/positions/uniswapv3/wizard/useMintPosition';
import { CHAIN_METADATA } from '@/config/chains';
import { parseTransactionError } from '@/utils/parse-evm-transaction-error';

interface PoolData {
  token0: {
    address: string;
    symbol: string;
    decimals: number;
  };
  token1: {
    address: string;
    symbol: string;
    decimals: number;
  };
}

interface TransactionStepsListProps {
  pool: PoolData;
  baseTokenAddress: string;
  quoteTokenAddress: string;
  requiredBaseAmount: bigint;
  requiredQuoteAmount: bigint;
  baseApproval: UseTokenApprovalResult;
  quoteApproval: UseTokenApprovalResult;
  mintPosition: UseMintPositionResult;
  canExecuteTransactions: boolean;
  isConnected: boolean;
  chain: EvmChainSlug;
  onApproval: (token: 'base' | 'quote') => void;
  onOpenPosition: () => void;
}

/**
 * Displays the transaction steps for opening a Uniswap V3 position
 *
 * Steps:
 * 1. Base token approval (if required amount > 0)
 * 2. Quote token approval (if required amount > 0)
 * 3. Open position (mint NFT)
 *
 * Each step shows:
 * - Status icon (Circle → Loader2 → Check)
 * - Action button when ready
 * - Block explorer link after transaction
 * - Inline error messages
 */
export function TransactionStepsList({
  pool,
  baseTokenAddress,
  quoteTokenAddress,
  requiredBaseAmount,
  requiredQuoteAmount,
  baseApproval,
  quoteApproval,
  mintPosition,
  canExecuteTransactions,
  isConnected,
  chain,
  onApproval,
  onOpenPosition,
}: TransactionStepsListProps) {
  const { openConnectModal } = useConnectModal();

  // Get block explorer URL for transaction
  const getExplorerUrl = (txHash: Address | undefined) => {
    if (!txHash || !chain) return null;
    const chainConfig = CHAIN_METADATA[chain];
    return `${chainConfig.explorer}/tx/${txHash}`;
  };

  // Get token data for display
  const baseTokenData =
    pool.token0.address.toLowerCase() === baseTokenAddress.toLowerCase()
      ? pool.token0
      : pool.token1;

  const quoteTokenData =
    pool.token0.address.toLowerCase() === quoteTokenAddress.toLowerCase()
      ? pool.token0
      : pool.token1;

  return (
    <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
      <h4 className="text-lg font-semibold text-white mb-4">
        Transaction Steps
      </h4>

      <div
        className={`space-y-4 ${!canExecuteTransactions ? 'opacity-50' : ''}`}
      >
        {/* Step 1: Base Token Approval - Only show if required amount > 0 */}
        {requiredBaseAmount > 0n && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {baseApproval.isLoadingAllowance ? (
                <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
              ) : baseApproval.isApproved ? (
                <Check className="w-5 h-5 text-green-500" />
              ) : (
                <Circle className="w-5 h-5 text-slate-400" />
              )}
              <span className="text-white flex-1">
                Approve{' '}
                {formatCompactValue(
                  requiredBaseAmount,
                  baseTokenData.decimals
                )}{' '}
                {baseTokenData.symbol}
              </span>
              {baseApproval.approvalTxHash && (
                <a
                  href={getExplorerUrl(baseApproval.approvalTxHash) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  title="View transaction on block explorer"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              {!baseApproval.isApproved &&
                canExecuteTransactions &&
                !baseApproval.isLoadingAllowance && (
                  <button
                    onClick={() => onApproval('base')}
                    disabled={
                      baseApproval.isApproving ||
                      baseApproval.isWaitingForConfirmation
                    }
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm rounded transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    {(baseApproval.isApproving ||
                      baseApproval.isWaitingForConfirmation) && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    {baseApproval.isWaitingForConfirmation
                      ? 'Confirming...'
                      : baseApproval.isApproving
                        ? 'Approving...'
                        : 'Approve'}
                  </button>
                )}
            </div>
            {baseApproval.approvalError && (
              <div className="ml-8 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-red-400 mb-1">
                      {parseTransactionError(baseApproval.approvalError).title}
                    </div>
                    <div className="text-sm text-red-300/90">
                      {parseTransactionError(baseApproval.approvalError).message}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Quote Token Approval - Only show if required amount > 0 */}
        {requiredQuoteAmount > 0n && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {quoteApproval.isLoadingAllowance ? (
                <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
              ) : quoteApproval.isApproved ? (
                <Check className="w-5 h-5 text-green-500" />
              ) : (
                <Circle className="w-5 h-5 text-slate-400" />
              )}
              <span className="text-white flex-1">
                Approve{' '}
                {formatCompactValue(
                  requiredQuoteAmount,
                  quoteTokenData.decimals
                )}{' '}
                {quoteTokenData.symbol}
              </span>
              {quoteApproval.approvalTxHash && (
                <a
                  href={getExplorerUrl(quoteApproval.approvalTxHash) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  title="View transaction on block explorer"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              {!quoteApproval.isApproved &&
                canExecuteTransactions &&
                !quoteApproval.isLoadingAllowance && (
                  <button
                    onClick={() => onApproval('quote')}
                    disabled={
                      quoteApproval.isApproving ||
                      quoteApproval.isWaitingForConfirmation
                    }
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm rounded transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    {(quoteApproval.isApproving ||
                      quoteApproval.isWaitingForConfirmation) && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    {quoteApproval.isWaitingForConfirmation
                      ? 'Confirming...'
                      : quoteApproval.isApproving
                        ? 'Approving...'
                        : 'Approve'}
                  </button>
                )}
            </div>
            {quoteApproval.approvalError && (
              <div className="ml-8 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-red-400 mb-1">
                      {parseTransactionError(quoteApproval.approvalError).title}
                    </div>
                    <div className="text-sm text-red-300/90">
                      {parseTransactionError(quoteApproval.approvalError).message}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Open Position */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            {mintPosition.isSuccess ? (
              <Check className="w-5 h-5 text-green-500" />
            ) : (
              <Circle className="w-5 h-5 text-slate-400" />
            )}
            <span className="text-white flex-1">Open Position</span>
            {mintPosition.mintTxHash && (
              <a
                href={getExplorerUrl(mintPosition.mintTxHash) || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                title="View transaction on block explorer"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            {!mintPosition.isSuccess &&
              canExecuteTransactions &&
              (requiredBaseAmount === 0n || baseApproval.isApproved) &&
              (requiredQuoteAmount === 0n || quoteApproval.isApproved) && (
                <button
                  onClick={onOpenPosition}
                  disabled={
                    mintPosition.isMinting ||
                    mintPosition.isWaitingForConfirmation
                  }
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white text-sm rounded transition-colors flex items-center gap-2 cursor-pointer"
                >
                  {(mintPosition.isMinting ||
                    mintPosition.isWaitingForConfirmation) && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  {mintPosition.isWaitingForConfirmation
                    ? 'Confirming...'
                    : mintPosition.isMinting
                      ? 'Minting...'
                      : 'Execute'}
                </button>
              )}
          </div>
          {mintPosition.isSuccess && mintPosition.tokenId && (
            <div className="text-xs text-green-400 ml-8">
              Position NFT #{mintPosition.tokenId.toString()} created
              successfully!
            </div>
          )}
          {mintPosition.mintError && (
            <div className="ml-8 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-red-400 mb-1">
                    {parseTransactionError(mintPosition.mintError).title}
                  </div>
                  <div className="text-sm text-red-300/90">
                    {parseTransactionError(mintPosition.mintError).message}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {!isConnected && (
        <div className="mt-4 text-center">
          <button
            onClick={() => openConnectModal?.()}
            className="text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer"
          >
            Connect wallet to continue
          </button>
        </div>
      )}
    </div>
  );
}
