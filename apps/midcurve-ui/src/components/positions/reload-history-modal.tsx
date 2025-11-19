/**
 * ReloadHistoryModal - Protocol-agnostic confirmation modal for reloading position history
 *
 * Features:
 * - React Portal for proper z-index stacking
 * - Warning UI with RefreshCw icon
 * - Protocol-specific position info display via slot component
 * - Loading state with spinner during reload (30-60 seconds)
 * - Error display for API failures
 * - Backdrop click to close (disabled during reload)
 * - All buttons disabled during reload operation
 *
 * Protocol-Agnostic Design:
 * - Generic modal shell works for all protocols
 * - Protocol-specific details rendered via PositionInfoDisplay component
 * - Reload endpoint determined via getReloadHistoryEndpoint helper
 */

"use client";

import { X, RefreshCw, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { ListPositionData } from "@midcurve/api-shared";
import { useReloadPositionHistory } from "@/hooks/positions/useReloadPositionHistory";
import { getReloadHistoryEndpoint } from "@/lib/position-helpers";
import { PositionInfoDisplay } from "./position-info-display";

interface ReloadHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: ListPositionData;
  onReloadSuccess?: () => void;
}

export function ReloadHistoryModal({
  isOpen,
  onClose,
  position,
  onReloadSuccess,
}: ReloadHistoryModalProps) {
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reload history mutation
  const reloadHistory = useReloadPositionHistory();

  // Handle reload confirmation
  const handleReload = async () => {
    try {
      const endpoint = getReloadHistoryEndpoint(position);

      // Use mutateAsync instead of mutate to properly await the result
      await reloadHistory.mutateAsync({
        endpoint,
        positionId: position.id,
      });

      // Call parent callback to handle any additional logic
      onReloadSuccess?.();

      // Close modal after successful reload
      onClose();
    } catch (error) {
      // Error is already displayed in the modal UI via reloadHistory.isError
      console.error('Failed to reload position history:', error);
    }
  };

  if (!isOpen || !mounted) return null;

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
                This will completely rebuild the position's event history from the blockchain.
              </p>
              <p className="text-slate-400 text-xs leading-relaxed">
                All ledger events, APR periods, and cached data will be refetched.
                This process may take 30-60 seconds depending on the position's age.
              </p>
            </div>

            {/* Protocol-specific position details */}
            <PositionInfoDisplay position={position} />

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
                {reloadHistory.error?.message || "Failed to reload position history"}
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
