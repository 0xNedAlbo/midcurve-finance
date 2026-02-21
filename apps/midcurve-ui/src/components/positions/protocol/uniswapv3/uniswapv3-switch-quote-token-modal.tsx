/**
 * UniswapV3SwitchQuoteTokenModal - Confirmation modal for switching quote/base tokens
 *
 * Shows the user which token will become the new quote token and explains
 * that all metrics will be recalculated. Uses React Portal for proper
 * z-index stacking.
 */

"use client";

import { X, ArrowRightLeft, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useSwitchQuoteToken } from "@/hooks/positions/useSwitchQuoteToken";
import { InfoRow } from "../../info-row";
import { formatChainName } from "@/lib/position-helpers";

interface UniswapV3SwitchQuoteTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchSuccess?: () => void;
  positionHash: string;
  chainId: number;
  nftId: number;
  token0Symbol: string;
  token1Symbol: string;
  feeBps: number;
  isToken0Quote: boolean;
}

export function UniswapV3SwitchQuoteTokenModal({
  isOpen,
  onClose,
  onSwitchSuccess,
  positionHash,
  chainId,
  nftId,
  token0Symbol,
  token1Symbol,
  feeBps,
  isToken0Quote,
}: UniswapV3SwitchQuoteTokenModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const switchQuoteToken = useSwitchQuoteToken(positionHash);

  const handleSwitch = async () => {
    try {
      await switchQuoteToken.mutateAsync({
        endpoint: `/api/v1/positions/uniswapv3/${chainId}/${nftId}/switch-quote-token`,
      });

      onSwitchSuccess?.();
      onClose();
    } catch (error) {
      console.error("Failed to switch quote token:", error);
    }
  };

  if (!isOpen || !mounted) return null;

  const currentQuoteSymbol = isToken0Quote ? token0Symbol : token1Symbol;
  const newQuoteSymbol = isToken0Quote ? token1Symbol : token0Symbol;
  const feePercentage = (feeBps / 10000).toFixed(2);

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={switchQuoteToken.isPending ? undefined : onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-xl shadow-black/20 w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <ArrowRightLeft className="w-5 h-5 text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold text-white">
                Switch Quote Token
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={switchQuoteToken.isPending}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Explanation */}
            <div className="space-y-2">
              <p className="text-slate-300 text-sm leading-relaxed">
                Switch which token is used as the reference currency for all
                financial metrics.
              </p>
              <p className="text-slate-400 text-xs leading-relaxed">
                All PnL, fees, cost basis, and APR values will be recalculated.
                This may take 30-60 seconds.
              </p>
            </div>

            {/* Position info */}
            <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
              <InfoRow label="NFT ID" value={`#${nftId}`} />
              <InfoRow
                label="Chain"
                value={formatChainName(chainId)}
                valueClassName="text-sm text-white"
              />
              <InfoRow
                label="Token Pair"
                value={`${token0Symbol}/${token1Symbol}`}
                valueClassName="text-sm text-white"
              />
              <InfoRow label="Fee Tier" value={`${feePercentage}%`} />
            </div>

            {/* Direction indicator */}
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="text-center flex-1">
                  <p className="text-xs text-slate-400 mb-1">Current Quote</p>
                  <p className="text-sm font-medium text-white">{currentQuoteSymbol}</p>
                </div>
                <ArrowRightLeft className="w-5 h-5 text-amber-400 mx-3 shrink-0" />
                <div className="text-center flex-1">
                  <p className="text-xs text-slate-400 mb-1">New Quote</p>
                  <p className="text-sm font-medium text-amber-400">{newQuoteSymbol}</p>
                </div>
              </div>
            </div>

            {/* Loading state */}
            {switchQuoteToken.isPending && (
              <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-amber-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Switching quote token and rebuilding history...</span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  This may take up to 60 seconds. Please wait.
                </p>
              </div>
            )}

            {/* Error display */}
            {switchQuoteToken.isError && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {switchQuoteToken.error?.message ||
                  "Failed to switch quote token"}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={switchQuoteToken.isPending}
                className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleSwitch}
                disabled={switchQuoteToken.isPending}
                className="flex-1 px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-700 disabled:bg-amber-600/50 text-white rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {switchQuoteToken.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Switching...
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="w-4 h-4" />
                    Switch to {newQuoteSymbol}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
