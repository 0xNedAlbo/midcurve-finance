"use client";

import { useState } from "react";
import type { HyperliquidPerpHedge } from "@midcurve/shared";
import { formatCompactValue } from "@/lib/fraction-format";
import { LeverageSelector } from "./leverage-selector";
import { BiasSelector } from "./bias-selector";
import { RefreshCw, Settings, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

interface HedgeAdjustmentControlsProps {
  hedge: HyperliquidPerpHedge;
  targetBaseAssetAmount: bigint;
  baseAssetDecimals: number;
  riskBaseSymbol: string; // Risk asset symbol (ETH, BTC) not token symbol (WETH, WBTC)
  currentPrice: number;
  onSyncToPosition?: () => void;
  onAdjustLeverage?: (leverage: number) => void;
  onAdjustBias?: (biasPercent: number) => void;
}

export function HedgeAdjustmentControls({
  hedge,
  targetBaseAssetAmount,
  baseAssetDecimals,
  riskBaseSymbol,
  currentPrice: _currentPrice,
}: HedgeAdjustmentControlsProps) {
  // Note: currentPrice will be used for future liquidation price calculations
  void _currentPrice;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newLeverage, setNewLeverage] = useState(
    hedge.config.hedgeParams.targetLeverage || 1
  );
  const [newBias, setNewBias] = useState(0);

  const { state, config } = hedge;
  const position = state.position;

  // Calculate current hedge size
  const currentSizeNum = position ? parseFloat(position.absSize) : 0;

  // Calculate target size
  const targetSizeNum = Number(targetBaseAssetAmount) / Math.pow(10, baseAssetDecimals);

  // Calculate difference
  const sizeDifference = targetSizeNum - currentSizeNum;
  const needsSync = Math.abs(sizeDifference) > 0.0001;

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">Hedge Controls</h3>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-300 transition-colors cursor-pointer"
        >
          <Settings className="w-4 h-4" />
          Advanced
          {showAdvanced ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Sync to Position Button */}
      <div className="mb-6">
        <div className="p-4 bg-slate-700/30 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-medium text-white">
                Sync Hedge to Position
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Adjust hedge size to match current base asset exposure
              </div>
            </div>
            {needsSync && (
              <span className="px-2 py-1 text-xs font-medium bg-amber-500/20 text-amber-400 rounded">
                Out of Sync
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
            <div>
              <div className="text-xs text-slate-400">Current Hedge</div>
              <div className="font-medium text-white">
                {currentSizeNum.toFixed(4)} {riskBaseSymbol}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Position Exposure</div>
              <div className="font-medium text-white">
                {formatCompactValue(targetBaseAssetAmount, baseAssetDecimals)} {riskBaseSymbol}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Difference</div>
              <div className={`font-medium ${
                Math.abs(sizeDifference) < 0.0001
                  ? "text-green-400"
                  : sizeDifference > 0
                    ? "text-blue-400"
                    : "text-red-400"
              }`}>
                {sizeDifference > 0 ? "+" : ""}
                {sizeDifference.toFixed(4)} {riskBaseSymbol}
              </div>
            </div>
          </div>

          <div className="relative group">
            <button
              disabled
              className={`
                w-full py-2.5 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors cursor-not-allowed
                ${needsSync
                  ? "bg-blue-600/50 text-blue-200"
                  : "bg-slate-600/50 text-slate-400"
                }
              `}
            >
              <RefreshCw className="w-4 h-4" />
              {needsSync
                ? sizeDifference > 0
                  ? "Increase Hedge Size"
                  : "Decrease Hedge Size"
                : "Hedge In Sync"}
            </button>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 whitespace-nowrap shadow-lg z-10">
              Coming soon - Backend integration required
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Controls */}
      {showAdvanced && (
        <div className="space-y-6 pt-6 border-t border-slate-700/50">
          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200">
              Adjusting leverage on an existing position may require additional margin or
              trigger partial liquidation. Review carefully before making changes.
            </p>
          </div>

          {/* Leverage Adjustment */}
          <div>
            <div className="text-sm font-medium text-slate-300 mb-3">
              Adjust Leverage
            </div>
            <LeverageSelector
              value={newLeverage}
              onChange={setNewLeverage}
              min={1}
              max={50}
            />
            {newLeverage !== (config.hedgeParams.targetLeverage || 1) && (
              <div className="mt-3">
                <div className="text-xs text-slate-400 mb-2">
                  Leverage change: {config.hedgeParams.targetLeverage || 1}x → {newLeverage}x
                </div>
                <div className="relative group">
                  <button
                    disabled
                    className="w-full py-2 px-4 bg-blue-600/50 text-blue-200 rounded-lg font-medium cursor-not-allowed"
                  >
                    Apply Leverage Change
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 whitespace-nowrap shadow-lg z-10">
                    Coming soon - Backend integration required
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bias Adjustment */}
          <div>
            <div className="text-sm font-medium text-slate-300 mb-3">
              Adjust Hedge Bias
            </div>
            <BiasSelector
              value={newBias}
              onChange={setNewBias}
              baseAssetAmount={targetBaseAssetAmount}
              riskBaseSymbol={riskBaseSymbol}
              baseAssetDecimals={baseAssetDecimals}
            />
            {newBias !== 0 && (
              <div className="mt-3">
                <div className="relative group">
                  <button
                    disabled
                    className="w-full py-2 px-4 bg-blue-600/50 text-blue-200 rounded-lg font-medium cursor-not-allowed"
                  >
                    Apply Bias Change
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 whitespace-nowrap shadow-lg z-10">
                    Coming soon - Backend integration required
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Close Hedge */}
          <div className="pt-4 border-t border-slate-700/50">
            <div className="relative group">
              <button
                disabled
                className="w-full py-2.5 px-4 bg-red-600/50 text-red-200 rounded-lg font-medium cursor-not-allowed"
              >
                Close Hedge
              </button>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 whitespace-nowrap shadow-lg z-10">
                Coming soon - Backend integration required
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2 text-center">
              Close the hedge position and return margin to main account
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
