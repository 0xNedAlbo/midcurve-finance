"use client";

import { useEffect } from "react";
import { useAccount } from "wagmi";
import {
  Shield,
  AlertCircle,
  Wallet,
  Check,
  ExternalLink,
} from "lucide-react";
import type { HedgeMarketResponse } from "@midcurve/api-shared";
import { formatCompactValue } from "@/lib/fraction-format";
import { TransactionStep } from "@/components/positions/TransactionStep";
import {
  useOpenHyperliquidHedge,
  type HedgeStep,
} from "@/hooks/hedges/hyperliquid/useOpenHyperliquidHedge";
import { UserRejectedError } from "@/hooks/hedges/hyperliquid/useHyperliquidClient";
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

/**
 * Hyperliquid Open Hedge Form
 *
 * Displays the 5-step flow for opening a hedge on Hyperliquid:
 * 1. Prepare Subaccount
 * 2. Fund Subaccount
 * 3. Place Order
 * 4. Monitor Execution
 * 5. Complete
 *
 * Uses TransactionStep component for consistent step visualization.
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
  const { isConnected } = useAccount();

  const hedge = useOpenHyperliquidHedge();

  // Notify parent of operation state changes
  useEffect(() => {
    const isInProgress =
      hedge.isRunning && !hedge.isComplete && hedge.currentStep !== "idle";
    onOperationStateChange?.(isInProgress);
  }, [hedge.isRunning, hedge.isComplete, hedge.currentStep, onOperationStateChange]);

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

  // Get current error (if any)
  const currentError =
    hedge.prepareSubaccountStatus.error ||
    hedge.fundSubaccountStatus.error ||
    hedge.placeOrderStatus.error ||
    hedge.monitorOrderStatus.error;

  const isUserRejected = currentError instanceof UserRejectedError;

  // Start the hedge opening process
  const handleStart = async () => {
    try {
      await hedge.start({
        positionHash,
        coin: riskBaseSymbol,
        hedgeSize: hedgeSizeNum.toFixed(6),
        leverage: hedgeConfig.leverage,
        notionalValueUsd: notionalValue,
        markPrice,
      });
    } catch {
      // Error already handled in hook
    }
  };

  // Retry from failed step
  const handleRetry = async () => {
    try {
      await hedge.retry();
    } catch {
      // Error already handled in hook
    }
  };

  // Handle success - close modal and notify parent
  const handleFinish = () => {
    onHedgeSuccess?.();
    onClose();
  };

  // Get step description based on current state
  const getStepDescription = (step: HedgeStep): string => {
    switch (step) {
      case "preparing_subaccount":
        return "Setting up isolated margin account on Hyperliquid...";
      case "funding_subaccount":
        return `Transferring $${marginWithBuffer.toFixed(2)} to subaccount...`;
      case "placing_order":
        return `Opening ${hedgeSizeNum.toFixed(4)} ${riskBaseSymbol} short position...`;
      case "monitoring_order":
        return "Waiting for order to fill...";
      case "complete":
        return "Hedge opened successfully!";
      default:
        return "";
    }
  };

  // Wallet not connected
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="p-4 bg-slate-700/50 rounded-full mb-4">
          <Wallet className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">
          Connect Your Wallet
        </h3>
        <p className="text-sm text-slate-400 text-center max-w-sm">
          Please connect your wallet to open a hedge position on Hyperliquid.
        </p>
      </div>
    );
  }

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
            hedge.prepareSubaccountStatus.isComplete && hedge.subaccountAddress
              ? `Subaccount ready: ${hedge.subaccountAddress.slice(0, 8)}...${hedge.subaccountAddress.slice(-6)}`
              : "Create or reuse a Hyperliquid subaccount"
          }
          isLoading={hedge.prepareSubaccountStatus.isLoading}
          isComplete={hedge.prepareSubaccountStatus.isComplete}
          isDisabled={hedge.currentStep !== "idle" && !hedge.prepareSubaccountStatus.error}
          onExecute={handleStart}
          showExecute={hedge.currentStep === "idle"}
        />

        {/* Step 2: Fund Subaccount */}
        <TransactionStep
          title="Fund Trading Account"
          description={
            hedge.fundSubaccountStatus.isComplete && hedge.marginTransferred
              ? `Transferred $${hedge.marginTransferred} to subaccount`
              : `Transfer $${marginWithBuffer.toFixed(2)} to subaccount`
          }
          isLoading={hedge.fundSubaccountStatus.isLoading}
          isComplete={hedge.fundSubaccountStatus.isComplete}
          isDisabled={!hedge.prepareSubaccountStatus.isComplete}
          onExecute={() => {}}
          showExecute={false}
        />

        {/* Step 3: Place Order */}
        <TransactionStep
          title="Place Short Order"
          description={
            hedge.placeOrderStatus.isComplete && hedge.orderId
              ? `Order placed (ID: ${hedge.orderId})`
              : `Open ${hedgeSizeNum.toFixed(4)} ${riskBaseSymbol} short at market`
          }
          isLoading={hedge.placeOrderStatus.isLoading}
          isComplete={hedge.placeOrderStatus.isComplete}
          isDisabled={!hedge.fundSubaccountStatus.isComplete}
          onExecute={() => {}}
          showExecute={false}
        />

        {/* Step 4: Monitor Execution */}
        <TransactionStep
          title="Order Execution"
          description={
            hedge.monitorOrderStatus.isComplete && hedge.fillPrice
              ? `Filled at $${parseFloat(hedge.fillPrice).toLocaleString()}`
              : hedge.placeOrderStatus.isComplete && hedge.fillPrice
                ? `Filled at $${parseFloat(hedge.fillPrice).toLocaleString()}`
                : "Waiting for order to fill..."
          }
          isLoading={hedge.monitorOrderStatus.isLoading}
          isComplete={
            hedge.monitorOrderStatus.isComplete ||
            (hedge.placeOrderStatus.isComplete && !!hedge.fillPrice)
          }
          isDisabled={!hedge.placeOrderStatus.isComplete}
          onExecute={() => {}}
          showExecute={false}
        />
      </div>

      {/* Status Message */}
      {hedge.isRunning && !hedge.isComplete && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Wallet className="w-5 h-5 text-blue-400 mt-0.5" />
            <div>
              <h4 className="text-blue-400 font-medium">
                {hedge.currentStep === "preparing_subaccount" ||
                hedge.currentStep === "funding_subaccount" ||
                hedge.currentStep === "placing_order"
                  ? "Signature Required"
                  : "Processing"}
              </h4>
              <p className="text-sm text-blue-200/80 mt-1">
                {getStepDescription(hedge.currentStep)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {currentError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-red-400 font-medium">
                {isUserRejected ? "Signature Rejected" : "Error"}
              </h4>
              <p className="text-sm text-red-200/80 mt-1">
                {currentError.message}
              </p>
            </div>
          </div>
          <button
            onClick={handleRetry}
            className="mt-3 px-4 py-2 text-sm font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Success State */}
      {hedge.isComplete && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Check className="w-5 h-5 text-green-400 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-green-400 font-medium">Hedge Opened!</h4>
              <p className="text-sm text-green-200/80 mt-1">
                Your {hedge.fillSize ?? hedgeSizeNum.toFixed(4)} {riskBaseSymbol}{" "}
                short position is now active
                {hedge.fillPrice &&
                  ` at $${parseFloat(hedge.fillPrice).toLocaleString()}`}
                .
              </p>
              {hedge.subaccountAddress && (
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
        {!hedge.isRunning && !hedge.isComplete && (
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 text-slate-300 hover:text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}

        {hedge.isComplete ? (
          <button
            onClick={handleFinish}
            className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            Done
          </button>
        ) : !hedge.isRunning ? (
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
