"use client";

import { useState, useEffect } from "react";
import {
  Shield,
  AlertCircle,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import type { HedgeMarketResponse } from "@midcurve/api-shared";
import { formatCompactValue } from "@/lib/fraction-format";
import { TransactionStep } from "@/components/positions/TransactionStep";
import { useOpenHedgeBackend } from "@/hooks/hedges/hyperliquid/useOpenHedgeBackend";
import type { HedgeFormConfig } from "../open-hedge-modal";

interface HyperliquidOpenHedgeFormProps {
  positionHash: string;
  baseAssetAmount: bigint;
  baseAssetDecimals: number;
  riskBaseSymbol: string;
  riskQuoteSymbol: string;
  currentPrice: number;
  hedgeConfig: HedgeFormConfig;
  hedgeMarket?: HedgeMarketResponse;
  onClose: () => void;
  onHedgeSuccess?: () => void;
  onOperationStateChange?: (isInProgress: boolean) => void;
}

type HedgeStep = "idle" | "preparing" | "funding" | "placing" | "monitoring" | "complete";

/**
 * Helper to delay execution for simulated step progression
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hyperliquid Open Hedge Form
 *
 * Displays the 4-step flow for opening a hedge on Hyperliquid:
 * 1. Prepare Trading Account (subaccount)
 * 2. Fund Trading Account (margin transfer)
 * 3. Place Short Order
 * 4. Order Execution (monitoring)
 *
 * All operations happen on the backend via a single API call.
 * Step progression is simulated for better UX.
 */
export function HyperliquidOpenHedgeForm({
  positionHash,
  baseAssetAmount,
  baseAssetDecimals,
  riskBaseSymbol,
  riskQuoteSymbol,
  currentPrice,
  hedgeConfig,
  hedgeMarket,
  onClose,
  onHedgeSuccess,
  onOperationStateChange,
}: HyperliquidOpenHedgeFormProps) {
  const [currentStep, setCurrentStep] = useState<HedgeStep>("idle");
  const openHedge = useOpenHedgeBackend();

  // Notify parent of operation state changes
  useEffect(() => {
    const isInProgress = currentStep !== "idle" && currentStep !== "complete";
    onOperationStateChange?.(isInProgress);
  }, [currentStep, onOperationStateChange]);

  // Calculate hedge parameters
  const multiplier = 1 + hedgeConfig.biasPercent / 100;
  const hedgeSize =
    (baseAssetAmount * BigInt(Math.round(multiplier * 10000))) / 10000n;
  const hedgeSizeNum = Number(hedgeSize) / Math.pow(10, baseAssetDecimals);

  // Use mark price from market data if available
  const markPrice = hedgeMarket?.marketData?.markPx
    ? parseFloat(hedgeMarket.marketData.markPx)
    : currentPrice;

  const notionalValue = hedgeSizeNum * markPrice;
  const requiredMargin = notionalValue / hedgeConfig.leverage;
  const marginWithBuffer = requiredMargin * 1.02; // 2% buffer

  // Start the hedge opening process
  const handleStart = async () => {
    setCurrentStep("preparing");

    try {
      // Simulate step progression for UX while backend handles everything
      const stepDelayMs = 400;

      // Start the backend call
      const resultPromise = openHedge.mutateAsync({
        positionHash,
        leverage: hedgeConfig.leverage,
        biasPercent: hedgeConfig.biasPercent,
        marginMode: hedgeConfig.marginMode,
        coin: riskBaseSymbol,
        hedgeSize: hedgeSizeNum.toFixed(6),
        notionalValueUsd: notionalValue.toFixed(2),
        markPrice: markPrice.toFixed(2),
      });

      // Simulate step progression
      await delay(stepDelayMs);
      setCurrentStep("funding");
      await delay(stepDelayMs);
      setCurrentStep("placing");
      await delay(stepDelayMs);
      setCurrentStep("monitoring");

      // Wait for result
      await resultPromise;

      setCurrentStep("complete");
    } catch {
      // Error is handled by the mutation, keep current step for retry
      // Reset to idle on error so user can retry
      setCurrentStep("idle");
    }
  };

  // Handle success - close modal and notify parent
  const handleFinish = () => {
    onHedgeSuccess?.();
    onClose();
  };

  // Check which steps are complete
  const isStepComplete = (step: HedgeStep): boolean => {
    const order: HedgeStep[] = ["idle", "preparing", "funding", "placing", "monitoring", "complete"];
    const currentIndex = order.indexOf(currentStep);
    const stepIndex = order.indexOf(step);
    return stepIndex < currentIndex;
  };

  const isStepLoading = (step: HedgeStep): boolean => {
    return currentStep === step;
  };

  return (
    <div className="space-y-6">
      {/* Hedge Summary */}
      <div className="bg-slate-700/30 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Shield className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-white">Hedge Summary</h4>
            <p className="text-xs text-slate-400">
              {hedgeMarket?.market ?? `${riskBaseSymbol}-${riskQuoteSymbol}`} on
              Hyperliquid
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-slate-400">Hedge Size</div>
            <div className="text-sm font-medium text-white">
              {formatCompactValue(hedgeSize, baseAssetDecimals)} {riskBaseSymbol}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Notional Value</div>
            <div className="text-sm font-medium text-white">
              ${notionalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Leverage</div>
            <div className="text-sm font-medium text-white">
              {hedgeConfig.leverage}x (Isolated)
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Required Margin</div>
            <div className="text-sm font-medium text-white">
              ${marginWithBuffer.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              <span className="text-xs text-slate-500 ml-1">(+2% buffer)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction Steps */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-slate-300">Transaction Steps</h4>

        {/* Step 1: Prepare Subaccount */}
        <TransactionStep
          title="Prepare Trading Account"
          description={
            isStepComplete("preparing") && openHedge.data?.subaccountAddress
              ? `Subaccount ready: ${openHedge.data.subaccountAddress.slice(0, 8)}...${openHedge.data.subaccountAddress.slice(-6)}`
              : "Create or reuse a Hyperliquid subaccount"
          }
          isLoading={isStepLoading("preparing")}
          isComplete={isStepComplete("preparing")}
          isDisabled={currentStep !== "idle"}
          onExecute={handleStart}
          showExecute={currentStep === "idle"}
        />

        {/* Step 2: Fund Subaccount */}
        <TransactionStep
          title="Fund Trading Account"
          description={
            isStepComplete("funding") && openHedge.data?.marginTransferred
              ? `Transferred $${openHedge.data.marginTransferred} to subaccount`
              : `Transfer $${marginWithBuffer.toFixed(2)} to subaccount`
          }
          isLoading={isStepLoading("funding")}
          isComplete={isStepComplete("funding")}
          isDisabled={true}
          onExecute={() => {}}
          showExecute={false}
        />

        {/* Step 3: Place Order */}
        <TransactionStep
          title="Place Short Order"
          description={
            isStepComplete("placing") && openHedge.data?.orderId
              ? `Order placed (ID: ${openHedge.data.orderId})`
              : `Open ${hedgeSizeNum.toFixed(4)} ${riskBaseSymbol} short at market`
          }
          isLoading={isStepLoading("placing")}
          isComplete={isStepComplete("placing")}
          isDisabled={true}
          onExecute={() => {}}
          showExecute={false}
        />

        {/* Step 4: Monitor Execution */}
        <TransactionStep
          title="Order Execution"
          description={
            currentStep === "complete" && openHedge.data?.fillPrice
              ? `Filled at $${parseFloat(openHedge.data.fillPrice).toLocaleString()}`
              : "Waiting for order to fill..."
          }
          isLoading={isStepLoading("monitoring")}
          isComplete={currentStep === "complete"}
          isDisabled={true}
          onExecute={() => {}}
          showExecute={false}
        />
      </div>

      {/* Status Message - Processing */}
      {currentStep !== "idle" && currentStep !== "complete" && !openHedge.error && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Loader2 className="w-5 h-5 text-blue-400 mt-0.5 animate-spin" />
            <div>
              <h4 className="text-blue-400 font-medium">Processing</h4>
              <p className="text-sm text-blue-200/80 mt-1">
                {currentStep === "preparing" && "Setting up isolated margin account..."}
                {currentStep === "funding" && `Transferring $${marginWithBuffer.toFixed(2)} to subaccount...`}
                {currentStep === "placing" && `Placing ${hedgeSizeNum.toFixed(4)} ${riskBaseSymbol} short order...`}
                {currentStep === "monitoring" && "Waiting for order to fill..."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {openHedge.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-red-400 font-medium">Error</h4>
              <p className="text-sm text-red-200/80 mt-1">
                {openHedge.error.message}
              </p>
            </div>
          </div>
          <button
            onClick={handleStart}
            className="mt-3 px-4 py-2 text-sm font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Success State */}
      {currentStep === "complete" && openHedge.data && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Check className="w-5 h-5 text-green-400 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-green-400 font-medium">Hedge Opened!</h4>
              <p className="text-sm text-green-200/80 mt-1">
                Your {openHedge.data.fillSize ?? hedgeSizeNum.toFixed(4)} {riskBaseSymbol}{" "}
                short position is now active
                {openHedge.data.fillPrice &&
                  ` at $${parseFloat(openHedge.data.fillPrice).toLocaleString()}`}
                .
              </p>
              {openHedge.data.subaccountAddress && (
                <a
                  href={`https://app.hyperliquid.xyz/trade/${riskBaseSymbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-green-400 hover:text-green-300 mt-2 cursor-pointer"
                >
                  View on Hyperliquid
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        {currentStep === "idle" && !openHedge.isPending && (
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 text-slate-300 hover:text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}

        {currentStep === "complete" ? (
          <button
            onClick={handleFinish}
            className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            Finish
          </button>
        ) : currentStep === "idle" && !openHedge.isPending ? (
          <button
            onClick={handleStart}
            className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Shield className="w-4 h-4" />
            Open Hedge
          </button>
        ) : null}
      </div>
    </div>
  );
}
