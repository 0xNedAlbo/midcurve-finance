"use client";

import { useState } from "react";
import { formatCompactValue } from "@/lib/fraction-format";
import { LeverageSelector } from "./leverage-selector";
import { BiasSelector } from "./bias-selector";
import { Shield, AlertTriangle, Lock } from "lucide-react";

interface HedgeCreateFormProps {
  baseAssetAmount: bigint;
  baseAssetDecimals: number;
  baseAssetSymbol: string;  // Position token symbol (WETH, WBTC)
  quoteTokenSymbol: string; // Position quote token symbol (USDC)
  riskBaseSymbol: string;   // Risk asset symbol (ETH, BTC) for hedge market
  riskQuoteSymbol: string;  // Risk quote symbol (USD) for hedge market
  currentPrice: number;
  onSubmit?: (config: HedgeFormConfig) => void;
}

export interface HedgeFormConfig {
  leverage: number;
  biasPercent: number;
  marginMode: "isolated";
}

export function HedgeCreateForm({
  baseAssetAmount,
  baseAssetDecimals,
  baseAssetSymbol,
  quoteTokenSymbol,
  riskBaseSymbol,
  riskQuoteSymbol,
  currentPrice,
}: HedgeCreateFormProps) {
  const [leverage, setLeverage] = useState(1);
  const [biasPercent, setBiasPercent] = useState(0);

  // Calculate derived values
  const multiplier = 1 + biasPercent / 100;
  const hedgeSize = (baseAssetAmount * BigInt(Math.round(multiplier * 10000))) / 10000n;
  const hedgeSizeNum = Number(hedgeSize) / Math.pow(10, baseAssetDecimals);

  // Calculate notional value in quote currency
  const notionalValue = hedgeSizeNum * currentPrice;

  // Calculate required margin
  const requiredMargin = notionalValue / leverage;

  // Estimate liquidation price (simplified calculation)
  // For a short: liquidation occurs when price rises
  // Rough estimate: entry_price * (1 + 1/leverage * margin_fraction)
  // Using 80% margin threshold for liquidation
  const estimatedLiquidationPrice = currentPrice * (1 + (0.8 / leverage));

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-blue-500/20 rounded-lg">
          <Shield className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">Create Hedge</h3>
          <p className="text-sm text-slate-400">
            Open a short position on Hyperliquid to hedge your {riskBaseSymbol} exposure
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Position Info and Hedge Market */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current Position Exposure */}
          <div className="p-4 bg-slate-700/30 rounded-lg">
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">
              Current Position Exposure
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-bold text-white">
                {formatCompactValue(baseAssetAmount, baseAssetDecimals)}
              </span>
              <span className="text-lg text-slate-400">{baseAssetSymbol}</span>
              <span className="text-lg text-slate-500">@</span>
              <span className="text-lg text-white">
                {currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-lg text-slate-400">{quoteTokenSymbol}</span>
            </div>
            <div className="text-sm text-slate-500 mt-1">
              Total value: {notionalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} {quoteTokenSymbol}
            </div>
          </div>

          {/* Hedge Market */}
          <div className="p-4 bg-slate-700/30 rounded-lg">
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">
              Hedge Market
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-blue-400">
                {riskBaseSymbol}-{riskQuoteSymbol}
              </span>
            </div>
            <div className="text-sm text-slate-500 mt-1">
              Hyperliquid Perpetual
            </div>
          </div>
        </div>

        {/* Leverage Selector */}
        <LeverageSelector
          value={leverage}
          onChange={setLeverage}
          min={1}
          max={50}
        />

        {/* Margin Mode (fixed) */}
        <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-500" />
            <span className="text-sm text-slate-300">Margin Mode</span>
          </div>
          <span className="px-2 py-1 text-xs font-medium bg-slate-600 text-slate-300 rounded">
            Isolated
          </span>
        </div>

        {/* Bias Selector */}
        <BiasSelector
          value={biasPercent}
          onChange={setBiasPercent}
          baseAssetAmount={baseAssetAmount}
          riskBaseSymbol={riskBaseSymbol}
          baseAssetDecimals={baseAssetDecimals}
        />

        {/* Preview Section */}
        <div className="border-t border-slate-700/50 pt-6">
          <h4 className="text-sm font-medium text-slate-300 mb-4">Hedge Preview</h4>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-slate-700/30 rounded-lg">
              <div className="text-xs text-slate-400">Hedge Size</div>
              <div className="text-lg font-semibold text-white">
                {formatCompactValue(hedgeSize, baseAssetDecimals)} {riskBaseSymbol}
              </div>
            </div>

            <div className="p-3 bg-slate-700/30 rounded-lg">
              <div className="text-xs text-slate-400">Notional Value</div>
              <div className="text-lg font-semibold text-white">
                {notionalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} {riskQuoteSymbol}
              </div>
            </div>

            <div className="p-3 bg-slate-700/30 rounded-lg">
              <div className="text-xs text-slate-400">Required Margin</div>
              <div className="text-lg font-semibold text-white">
                {requiredMargin.toLocaleString(undefined, { maximumFractionDigits: 2 })} {riskQuoteSymbol}
              </div>
            </div>

            <div className="p-3 bg-slate-700/30 rounded-lg">
              <div className="text-xs text-slate-400">Est. Liquidation Price</div>
              <div className="text-lg font-semibold text-amber-400">
                {estimatedLiquidationPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} {riskQuoteSymbol}
              </div>
            </div>
          </div>

          {/* Liquidation Warning */}
          <div className="flex items-start gap-2 mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200">
              Estimated liquidation price may vary based on market conditions and funding rates.
              Always ensure adequate margin to avoid liquidation.
            </p>
          </div>
        </div>

        {/* Submit Button (disabled) */}
        <div className="relative group">
          <button
            disabled
            className="w-full py-3 px-4 bg-blue-600/50 text-blue-200 font-medium rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Shield className="w-4 h-4" />
            Open Hedge
          </button>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 whitespace-nowrap shadow-lg z-10">
            Coming soon - Backend integration required
          </div>
        </div>
      </div>
    </div>
  );
}
