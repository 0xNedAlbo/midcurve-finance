"use client";

import { formatCompactValue } from "@/lib/fraction-format";
import { Info } from "lucide-react";

interface BiasSelectorProps {
  value: number; // -100 to +100
  onChange: (value: number) => void;
  baseAssetAmount: bigint;
  riskBaseSymbol: string; // Risk asset symbol (ETH, BTC) not token symbol (WETH, WBTC)
  baseAssetDecimals: number;
  disabled?: boolean;
}

const QUICK_SELECT_VALUES = [-50, -25, 0, 25, 50];

export function BiasSelector({
  value,
  onChange,
  baseAssetAmount,
  riskBaseSymbol,
  baseAssetDecimals,
  disabled = false,
}: BiasSelectorProps) {
  // Calculate hedge size with bias
  // Bias > 0 = bearish = larger short
  // Bias < 0 = bullish = smaller short
  const multiplier = 1 + value / 100;
  const hedgeSize = (baseAssetAmount * BigInt(Math.round(multiplier * 10000))) / 10000n;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  // Get bias label and color
  const getBiasInfo = () => {
    if (value > 10) return { label: "Bearish", color: "text-red-400", bgColor: "bg-red-500/20" };
    if (value < -10) return { label: "Bullish", color: "text-green-400", bgColor: "bg-green-500/20" };
    return { label: "Neutral", color: "text-slate-400", bgColor: "bg-slate-500/20" };
  };

  const biasInfo = getBiasInfo();

  // Calculate slider background gradient
  const getSliderBackground = () => {
    return `linear-gradient(to right,
      rgb(34, 197, 94) 0%,
      rgb(100, 116, 139) 50%,
      rgb(239, 68, 68) 100%)`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-300">Bias</label>
          <div className="group relative">
            <Info className="w-4 h-4 text-slate-500 cursor-help" />
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 z-10 shadow-lg">
              <p><strong>Bearish (+)</strong>: Larger short position, expecting price to fall</p>
              <p className="mt-1"><strong>Bullish (-)</strong>: Smaller short position, expecting price to rise</p>
            </div>
          </div>
        </div>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${biasInfo.bgColor} ${biasInfo.color}`}>
          {biasInfo.label} {value > 0 ? "+" : ""}{value}%
        </span>
      </div>

      {/* Slider with gradient */}
      <div className="relative">
        <input
          type="range"
          min={-100}
          max={100}
          value={value}
          onChange={handleSliderChange}
          disabled={disabled}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: getSliderBackground() }}
        />
        {/* Custom thumb styling */}
        <style jsx>{`
          input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: white;
            cursor: pointer;
            border: 2px solid rgb(59, 130, 246);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          }
          input[type="range"]::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: white;
            cursor: pointer;
            border: 2px solid rgb(59, 130, 246);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          }
        `}</style>
        {/* Labels */}
        <div className="flex justify-between mt-1 text-xs text-slate-500">
          <span>Bullish -100%</span>
          <span>Neutral</span>
          <span>Bearish +100%</span>
        </div>
      </div>

      {/* Quick Select Buttons */}
      <div className="flex gap-2">
        {QUICK_SELECT_VALUES.map((quickValue) => (
          <button
            key={quickValue}
            onClick={() => onChange(quickValue)}
            disabled={disabled}
            className={`
              flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer
              ${value === quickValue
                ? quickValue > 0
                  ? "bg-red-600/50 text-red-200"
                  : quickValue < 0
                    ? "bg-green-600/50 text-green-200"
                    : "bg-slate-600 text-white"
                : "bg-slate-700/50 text-slate-400 hover:bg-slate-600/50 hover:text-slate-300"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {quickValue > 0 ? "+" : ""}{quickValue}%
          </button>
        ))}
      </div>

      {/* Calculated Hedge Size */}
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <div className="text-xs text-slate-400 mb-1">Calculated Hedge Size</div>
        <div className="text-sm text-white">
          <span className="text-slate-400">
            {formatCompactValue(baseAssetAmount, baseAssetDecimals)} {riskBaseSymbol}
          </span>
          <span className="text-slate-500 mx-2">×</span>
          <span className={multiplier !== 1 ? biasInfo.color : "text-slate-400"}>
            {multiplier.toFixed(2)}
          </span>
          <span className="text-slate-500 mx-2">=</span>
          <span className="font-medium">
            {formatCompactValue(hedgeSize, baseAssetDecimals)} {riskBaseSymbol}
          </span>
        </div>
      </div>
    </div>
  );
}
