/**
 * StrategyLifecycleModal - Confirmation modal for strategy start/shutdown operations
 *
 * Features:
 * - React Portal for proper z-index stacking
 * - Action-specific icon (Play for Start, Power for Shutdown)
 * - Warning message explaining the action
 * - Loading state with spinner during API call
 * - Error display for failures
 * - Backdrop click to close (disabled during loading)
 */

"use client";

import { X, Play, Power, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { ListStrategyData } from "@midcurve/api-shared";
import { useStartStrategy } from "@/hooks/strategies/useStartStrategy";
import { useShutdownStrategy } from "@/hooks/strategies/useShutdownStrategy";

interface StrategyLifecycleModalProps {
  isOpen: boolean;
  onClose: () => void;
  strategy: ListStrategyData;
  action: "start" | "shutdown";
  onSuccess?: () => void;
}

export function StrategyLifecycleModal({
  isOpen,
  onClose,
  strategy,
  action,
  onSuccess,
}: StrategyLifecycleModalProps) {
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Mutation hooks
  const startStrategy = useStartStrategy();
  const shutdownStrategy = useShutdownStrategy();

  // Select the appropriate mutation based on action
  const mutation = action === "start" ? startStrategy : shutdownStrategy;

  // Handle action confirmation
  const handleConfirm = async () => {
    if (!strategy.contractAddress) {
      console.error("No contract address for strategy");
      return;
    }

    try {
      await mutation.mutateAsync({
        contractAddress: strategy.contractAddress,
      });

      // Call parent callback to handle any additional logic
      onSuccess?.();

      // Close modal after successful operation
      onClose();
    } catch (error) {
      // Error is already displayed in the modal UI via mutation.isError
      console.error(`Failed to ${action} strategy:`, error);
    }
  };

  if (!isOpen || !mounted) return null;

  // Action-specific configuration
  const config = {
    start: {
      icon: Play,
      title: "Start Strategy",
      buttonText: "Start Strategy",
      buttonLoadingText: "Starting...",
      buttonColor: "bg-green-600 hover:bg-green-700 disabled:bg-green-600/50",
      iconBgColor: "bg-green-500/10 border-green-500/20",
      iconColor: "text-green-400",
      message:
        "Are you sure you want to start this strategy? Once started, the strategy will begin processing events and executing its logic.",
    },
    shutdown: {
      icon: Power,
      title: "Shutdown Strategy",
      buttonText: "Shutdown Strategy",
      buttonLoadingText: "Shutting down...",
      buttonColor: "bg-orange-600 hover:bg-orange-700 disabled:bg-orange-600/50",
      iconBgColor: "bg-orange-500/10 border-orange-500/20",
      iconColor: "text-orange-400",
      message:
        "Are you sure you want to shutdown this strategy? The strategy will stop processing events and enter a shutdown state. This operation may take a moment to complete.",
    },
  };

  const { icon: Icon, title, buttonText, buttonLoadingText, buttonColor, iconBgColor, iconColor, message } =
    config[action];

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={mutation.isPending ? undefined : onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-xl shadow-black/20 w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className={`p-2 border rounded-lg ${iconBgColor}`}>
                <Icon className={`w-5 h-5 ${iconColor}`} />
              </div>
              <h2 className="text-lg font-semibold text-white">{title}</h2>
            </div>
            <button
              onClick={onClose}
              disabled={mutation.isPending}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Warning message */}
            <p className="text-slate-300 text-sm leading-relaxed">{message}</p>

            {/* Strategy info */}
            <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Strategy</span>
                <span className="text-white font-medium">{strategy.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Type</span>
                <span className="text-slate-300">{strategy.strategyType}</span>
              </div>
              {strategy.contractAddress && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Contract</span>
                  <span className="text-slate-300 font-mono text-xs">
                    {strategy.contractAddress.slice(0, 6)}...
                    {strategy.contractAddress.slice(-4)}
                  </span>
                </div>
              )}
            </div>

            {/* Error display */}
            {mutation.isError && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {mutation.error?.message || `Failed to ${action} strategy`}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={mutation.isPending}
                className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={mutation.isPending}
                className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2 ${buttonColor}`}
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {buttonLoadingText}
                  </>
                ) : (
                  buttonText
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
