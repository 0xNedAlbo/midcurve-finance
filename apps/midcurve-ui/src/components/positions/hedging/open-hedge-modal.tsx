"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle } from "lucide-react";
import type { HedgeMarketResponse } from "@midcurve/api-shared";
import { HyperliquidOpenHedgeForm } from "./hyperliquid/hyperliquid-open-hedge-form";

export interface HedgeFormConfig {
  leverage: number;
  biasPercent: number;
  marginMode: "isolated";
}

interface OpenHedgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onHedgeSuccess?: () => void;

  // Position data
  positionHash: string;
  baseAssetAmount: bigint;
  baseAssetDecimals: number;
  riskBaseSymbol: string;
  riskQuoteSymbol: string;
  currentPrice: number;

  // Form config from hedge create form
  hedgeConfig: HedgeFormConfig;

  // Market data from eligibility check
  hedgeMarket?: HedgeMarketResponse;
}

/**
 * Open Hedge Modal - Shell Component
 *
 * Displays a modal for opening a hedge position on Hyperliquid.
 * Routes to protocol-specific forms based on market protocol.
 *
 * Features:
 * - Portal-based rendering (renders to document.body)
 * - Close confirmation when operation is in progress
 * - Protocol-agnostic shell with protocol-specific content
 */
export function OpenHedgeModal({
  isOpen,
  onClose,
  onHedgeSuccess,
  positionHash,
  baseAssetAmount,
  baseAssetDecimals,
  riskBaseSymbol,
  riskQuoteSymbol,
  currentPrice,
  hedgeConfig,
  hedgeMarket,
}: OpenHedgeModalProps) {
  const [mounted, setMounted] = useState(false);
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);
  const [isOperationInProgress, setIsOperationInProgress] = useState(false);

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle close with confirmation if operation in progress
  const handleClose = () => {
    if (isOperationInProgress) {
      setShowCloseConfirmation(true);
    } else {
      onClose();
    }
  };

  // Confirm close
  const handleConfirmClose = () => {
    setShowCloseConfirmation(false);
    onClose();
  };

  // Cancel close
  const handleCancelClose = () => {
    setShowCloseConfirmation(false);
  };

  if (!isOpen || !mounted) return null;

  // Get protocol from market response
  const protocol = hedgeMarket?.protocol ?? "hyperliquid";

  // Render protocol-specific form
  const renderForm = () => {
    switch (protocol) {
      case "hyperliquid":
        return (
          <HyperliquidOpenHedgeForm
            positionHash={positionHash}
            baseAssetAmount={baseAssetAmount}
            baseAssetDecimals={baseAssetDecimals}
            riskBaseSymbol={riskBaseSymbol}
            riskQuoteSymbol={riskQuoteSymbol}
            currentPrice={currentPrice}
            hedgeConfig={hedgeConfig}
            hedgeMarket={hedgeMarket}
            onClose={onClose}
            onHedgeSuccess={onHedgeSuccess}
            onOperationStateChange={setIsOperationInProgress}
          />
        );
      default:
        return (
          <div className="text-center py-12">
            <p className="text-slate-400">
              Hedge protocol not supported: {protocol}
            </p>
          </div>
        );
    }
  };

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 w-full max-w-2xl max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div>
              <h2 className="text-2xl font-bold text-white">Open Hedge</h2>
              <p className="text-sm text-slate-400 mt-1">
                Create a short position on Hyperliquid to hedge your{" "}
                {riskBaseSymbol} exposure
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
            {renderForm()}
          </div>
        </div>
      </div>

      {/* Close Confirmation Dialog */}
      {showCloseConfirmation && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[60]" />
          <div className="fixed inset-0 flex items-center justify-center z-[70] p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 bg-amber-500/20 rounded-full">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Operation In Progress
                  </h3>
                  <p className="text-sm text-slate-400">
                    Closing now may leave your hedge in an incomplete state.
                    Funds may be transferred to the subaccount without a
                    position being opened.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={handleCancelClose}
                  className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  Continue Operation
                </button>
                <button
                  onClick={handleConfirmClose}
                  className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors cursor-pointer"
                >
                  Close Anyway
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );

  return createPortal(modalContent, document.body);
}
