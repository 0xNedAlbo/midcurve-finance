"use client";

import type { HyperliquidPerpHedge } from "@midcurve/shared";
import { formatCompactValue } from "@/lib/fraction-format";
import { TrendingUp, TrendingDown, DollarSign, Activity, Clock } from "lucide-react";

interface HedgeMetricsCardProps {
  hedge: HyperliquidPerpHedge;
  targetBaseAssetAmount: bigint;
  baseAssetDecimals: number;
  riskBaseSymbol: string; // Risk asset symbol (ETH, BTC) not token symbol (WETH, WBTC)
  quoteTokenSymbol: string;
  quoteTokenDecimals: number;
}

export function HedgeMetricsCard({
  hedge,
  targetBaseAssetAmount,
  baseAssetDecimals,
  riskBaseSymbol,
  quoteTokenSymbol: _quoteTokenSymbol,
  quoteTokenDecimals: _quoteTokenDecimals,
}: HedgeMetricsCardProps) {
  // Note: quote token params reserved for future PnL formatting
  void _quoteTokenSymbol;
  void _quoteTokenDecimals;
  const { state, config } = hedge;
  const position = state.position;

  // Calculate current hedge size in base asset terms
  const currentSizeNum = position ? parseFloat(position.absSize) : 0;

  // Calculate target size from position
  const targetSizeNum = Number(targetBaseAssetAmount) / Math.pow(10, baseAssetDecimals);

  // Calculate size difference
  const sizeDifference = currentSizeNum - targetSizeNum;
  const sizeDifferencePercent = targetSizeNum > 0
    ? ((sizeDifference / targetSizeNum) * 100).toFixed(1)
    : "0";

  // Parse funding values
  const funding = position?.funding;
  const cumFundingSinceOpen = funding ? parseFloat(funding.cumFundingSinceOpen) : 0;
  const currentFundingRate = funding?.currentFundingRate
    ? parseFloat(funding.currentFundingRate)
    : 0;

  // Calculate annualized funding rate (funding rate is usually per 8 hours)
  const annualizedFundingRate = currentFundingRate * 3 * 365 * 100; // 3 funding periods per day

  // Account snapshot
  const accountSnapshot = state.accountSnapshot;

  // Format date for last sync
  const formatLastSync = () => {
    const lastSync = new Date(state.lastSyncAt);
    const now = new Date();
    const diffMs = now.getTime() - lastSync.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return lastSync.toLocaleDateString();
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">Hedge Metrics</h3>
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <Clock className="w-3 h-3" />
          <span>Updated {formatLastSync()}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Current Size vs Target */}
        <div className="p-4 bg-slate-700/30 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
            <Activity className="w-3 h-3" />
            Current vs Target Size
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-slate-400">Current</span>
              <span className="text-sm font-medium text-white">
                {currentSizeNum.toFixed(4)} {riskBaseSymbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-slate-400">Target</span>
              <span className="text-sm font-medium text-white">
                {formatCompactValue(targetBaseAssetAmount, baseAssetDecimals)} {riskBaseSymbol}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-600/50">
              <div className={`flex justify-between text-sm ${
                Math.abs(parseFloat(sizeDifferencePercent)) < 5
                  ? "text-green-400"
                  : Math.abs(parseFloat(sizeDifferencePercent)) < 20
                    ? "text-amber-400"
                    : "text-red-400"
              }`}>
                <span>Difference</span>
                <span>
                  {sizeDifference > 0 ? "+" : ""}
                  {sizeDifference.toFixed(4)} ({sizeDifferencePercent}%)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Funding */}
        <div className="p-4 bg-slate-700/30 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
            {cumFundingSinceOpen >= 0 ? (
              <TrendingUp className="w-3 h-3 text-green-400" />
            ) : (
              <TrendingDown className="w-3 h-3 text-red-400" />
            )}
            Funding
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-slate-400">Cumulative</span>
              <span className={`text-sm font-medium ${
                cumFundingSinceOpen >= 0 ? "text-green-400" : "text-red-400"
              }`}>
                {cumFundingSinceOpen >= 0 ? "+" : ""}
                ${cumFundingSinceOpen.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-slate-400">Current Rate</span>
              <span className={`text-sm font-medium ${
                currentFundingRate <= 0 ? "text-green-400" : "text-red-400"
              }`}>
                {(currentFundingRate * 100).toFixed(4)}%
              </span>
            </div>
            <div className="pt-2 border-t border-slate-600/50">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Annualized</span>
                <span className={
                  annualizedFundingRate <= 0 ? "text-green-400" : "text-red-400"
                }>
                  {annualizedFundingRate >= 0 ? "+" : ""}
                  {annualizedFundingRate.toFixed(2)}% APR
                </span>
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            {currentFundingRate > 0
              ? "Longs pay shorts (favorable)"
              : currentFundingRate < 0
                ? "Shorts pay longs (unfavorable)"
                : "Neutral"}
          </div>
        </div>

        {/* Account Balance */}
        <div className="p-4 bg-slate-700/30 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
            <DollarSign className="w-3 h-3" />
            Subaccount Balance
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-slate-400">Account Value</span>
              <span className="text-sm font-medium text-white">
                ${accountSnapshot
                  ? parseFloat(accountSnapshot.accountValue).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "-"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-slate-400">Margin Used</span>
              <span className="text-sm font-medium text-white">
                ${accountSnapshot
                  ? parseFloat(accountSnapshot.totalMarginUsed).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "-"}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-600/50">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Withdrawable</span>
                <span className="font-medium text-green-400">
                  ${accountSnapshot
                    ? parseFloat(accountSnapshot.withdrawable).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "-"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hedge Parameters Summary */}
      <div className="mt-4 pt-4 border-t border-slate-700/50">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-slate-400">Target Leverage</span>
            <span className="ml-2 text-white font-medium">
              {config.hedgeParams.targetLeverage || 1}x
            </span>
          </div>
          <div>
            <span className="text-slate-400">Margin Mode</span>
            <span className="ml-2 text-white font-medium capitalize">
              {config.hedgeParams.marginMode}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Target Notional</span>
            <span className="ml-2 text-white font-medium">
              ${parseFloat(config.hedgeParams.targetNotionalUsd).toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Reduce Only</span>
            <span className="ml-2 text-white font-medium">
              {config.hedgeParams.reduceOnly ? "Yes" : "No"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
