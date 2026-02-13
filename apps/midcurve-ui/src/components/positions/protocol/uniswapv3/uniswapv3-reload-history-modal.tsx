/**
 * UniswapV3ReloadHistoryModal - Confirmation modal for reloading a Uniswap V3 position's history
 *
 * Protocol-specific modal that takes flat props (no full position object needed).
 * Uses React Portal for proper z-index stacking.
 */

"use client";

import { X, RefreshCw, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useReloadPositionHistory } from "@/hooks/positions/useReloadPositionHistory";
import { InfoRow } from "../../info-row";
import { formatChainName } from "@/lib/position-helpers";

interface UniswapV3ReloadHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReloadSuccess?: () => void;
  positionHash: string;
  chainId: number;
  nftId: number;
  token0Symbol: string;
  token1Symbol: string;
  feeBps: number;
}

export function UniswapV3ReloadHistoryModal({
  isOpen,
  onClose,
  onReloadSuccess,
  positionHash,
  chainId,
  nftId,
  token0Symbol,
  token1Symbol,
  feeBps,
}: UniswapV3ReloadHistoryModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const reloadHistory = useReloadPositionHistory(positionHash);

  const handleReload = async () => {
    try {
      await reloadHistory.mutateAsync({
        endpoint: `/api/v1/positions/uniswapv3/${chainId}/${nftId}/reload-history`,
      });

      onReloadSuccess?.();
      onClose();
    } catch (error) {
      console.error("Failed to reload position history:", error);
    }
  };

  if (!isOpen || !mounted) return null;

  const feePercentage = (feeBps / 10000).toFixed(2);

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={reloadHistory.isPending ? undefined : onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-xl shadow-black/20 w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <RefreshCw className="w-5 h-5 text-blue-400" />
              </div>
              <h2 className="text-lg font-semibold text-white">
                Reload History
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={reloadHistory.isPending}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Warning message */}
            <div className="space-y-2">
              <p className="text-slate-300 text-sm leading-relaxed">
                This will completely rebuild the position&apos;s event history
                from the blockchain.
              </p>
              <p className="text-slate-400 text-xs leading-relaxed">
                All ledger events, APR periods, and cached data will be
                refetched. This process may take 30-60 seconds depending on the
                position&apos;s age.
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

            {/* Loading state with additional info */}
            {reloadHistory.isPending && (
              <div className="px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-blue-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Rebuilding position history...</span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  This may take up to 60 seconds. Please wait.
                </p>
              </div>
            )}

            {/* Error display */}
            {reloadHistory.isError && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {reloadHistory.error?.message ||
                  "Failed to reload position history"}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={reloadHistory.isPending}
                className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleReload}
                disabled={reloadHistory.isPending}
                className="flex-1 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {reloadHistory.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Reloading...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Reload History
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
