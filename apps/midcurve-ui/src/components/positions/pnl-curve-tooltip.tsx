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
  const isProfitable = pnl > 0;
  const statusLabel = isProfitable ? "Profit (Fees)" : "Loss (IL)";
  const statusColor = isProfitable ? "text-green-400" : "text-red-400";

  return (
    <div className="bg-slate-800/95 border border-slate-700 rounded-lg p-3 shadow-xl backdrop-blur-sm">
      <p className="text-slate-300 text-sm">
        <strong>Price:</strong> {quoteToken.symbol}{" "}
        {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </p>
      <p className="text-slate-300 text-sm">
        <strong>Position Value:</strong> {quoteToken.symbol}{" "}
        {positionValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </p>
      <p
        className={`text-sm font-medium ${
          pnl >= 0 ? "text-green-400" : "text-red-400"
        }`}
      >
        <strong>PnL:</strong> {quoteToken.symbol}{" "}
        {pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })} (
        {pnlPercent.toFixed(2)}%)
      </p>
      <p className={`text-xs ${statusColor}`}>Status: {statusLabel}</p>
    </div>
  );
}
