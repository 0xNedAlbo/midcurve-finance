/**
 * DeletePositionModal - Protocol-agnostic confirmation modal for deleting positions
 *
 * Features:
 * - React Portal for proper z-index stacking
 * - Warning UI with AlertTriangle icon
 * - Protocol-specific position info display via slot component
 * - Loading state with spinner during deletion
 * - Error display for API failures
 * - Backdrop click to close
 * - All buttons disabled during deletion
 *
 * Protocol-Agnostic Design:
 * - Generic modal shell works for all protocols
 * - Protocol-specific details rendered via PositionInfoDisplay component
 * - Delete endpoint determined via getDeleteEndpoint helper
 */

"use client";

import { X, AlertTriangle, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { ListPositionData } from "@midcurve/api-shared";
import { useDeletePosition } from "@/hooks/positions/useDeletePosition";
import { getDeleteEndpoint } from "@/lib/position-helpers";
import { PositionInfoDisplay } from "./position-info-display";

interface DeletePositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: ListPositionData;
  onDeleteSuccess?: () => void;
}

export function DeletePositionModal({
  isOpen,
  onClose,
  position,
  onDeleteSuccess,
}: DeletePositionModalProps) {
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Delete mutation
  const deletePosition = useDeletePosition();

  // Handle delete confirmation
  const handleDelete = async () => {
    try {
      const endpoint = getDeleteEndpoint(position);

      // Use mutateAsync instead of mutate to properly await the result
      await deletePosition.mutateAsync({
        endpoint,
        positionId: position.id,
      });

      // Call parent callback to handle any additional logic
      onDeleteSuccess?.();

      // Close modal after successful deletion
      onClose();
    } catch (error) {
      // Error is already displayed in the modal UI via deletePosition.isError
      console.error('Failed to delete position:', error);
    }
  };

  if (!isOpen || !mounted) return null;

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
            {/* Warning message */}
            <p className="text-slate-300 text-sm leading-relaxed">
              Are you sure you want to delete this position? This action cannot
              be undone and will permanently remove the position from your
              portfolio.
            </p>

            {/* Protocol-specific position details */}
            <PositionInfoDisplay position={position} />

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
