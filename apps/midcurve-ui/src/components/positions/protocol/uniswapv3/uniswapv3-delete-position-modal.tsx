/**
 * UniswapV3DeletePositionModal - Confirmation modal for deleting a Uniswap V3 position
 *
 * Protocol-specific modal that takes flat props (no full position object needed).
 * Uses React Portal for proper z-index stacking.
 */

"use client";

import { X, AlertTriangle, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useDeletePosition } from "@/hooks/positions/useDeletePosition";
import { InfoRow } from "../../info-row";
import { formatChainName } from "@/lib/position-helpers";

interface UniswapV3DeletePositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeleteSuccess?: () => void;
  positionHash: string;
  chainId: number;
  nftId: number;
  token0Symbol: string;
  token1Symbol: string;
  feeBps: number;
}

export function UniswapV3DeletePositionModal({
  isOpen,
  onClose,
  onDeleteSuccess,
  positionHash,
  chainId,
  nftId,
  token0Symbol,
  token1Symbol,
  feeBps,
}: UniswapV3DeletePositionModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const deletePosition = useDeletePosition(positionHash);

  const handleDelete = async () => {
    try {
      await deletePosition.mutateAsync({
        endpoint: `/api/v1/positions/uniswapv3/${chainId}/${nftId}`,
      });

      onDeleteSuccess?.();
      onClose();
    } catch (error) {
      console.error("Failed to delete position:", error);
    }
  };

  if (!isOpen || !mounted) return null;

  const feePercentage = (feeBps / 10000).toFixed(2);

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={deletePosition.isPending ? undefined : onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-xl shadow-black/20 w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h2 className="text-lg font-semibold text-white">
                Delete Position
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={deletePosition.isPending}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <p className="text-slate-300 text-sm leading-relaxed">
              Are you sure you want to delete this position? This action cannot
              be undone and will permanently remove the position from your
              portfolio.
            </p>

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

            {/* Error display */}
            {deletePosition.isError && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {deletePosition.error?.message || "Failed to delete position"}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={deletePosition.isPending}
                className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deletePosition.isPending}
                className="flex-1 px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {deletePosition.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete Position"
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
