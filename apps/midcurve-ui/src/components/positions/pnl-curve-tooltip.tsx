"use client";

import type { Erc20Token } from "@midcurve/shared";

interface PnLCurveTooltipProps {
  price: number;
  positionValue: number;
  pnl: number;
  pnlPercent: number;
  quoteToken: Erc20Token;
}

export function PnLCurveTooltip({
  price,
  positionValue,
  pnl,
  pnlPercent,
  quoteToken,
}: PnLCurveTooltipProps) {
  return (
    <div className="bg-slate-800/95 border border-slate-700 rounded-lg p-3 shadow-xl backdrop-blur-sm">
      <p className="text-slate-300 text-sm">
        <strong>Price:</strong>{" "}
        {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
        {quoteToken.symbol}
      </p>
      <p className="text-slate-300 text-sm">
        <strong>Position Value:</strong>{" "}
        {positionValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
        {quoteToken.symbol}
      </p>
      <p
        className={`text-sm font-medium ${
          pnl >= 0 ? "text-green-400" : "text-red-400"
        }`}
      >
        <strong>PnL:</strong>{" "}
        {pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
        {quoteToken.symbol} ({pnlPercent.toFixed(2)}%)
      </p>
    </div>
  );
}
