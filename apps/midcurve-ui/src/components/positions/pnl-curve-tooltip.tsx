"use client";

import type { Erc20TokenResponse } from "@midcurve/api-shared";
import { formatCompactValue } from "@/lib/fraction-format";
import { formatPercentage } from "@/lib/format-helpers";

interface PnLCurveTooltipProps {
  price: bigint;
  positionValue: bigint;
  pnl: bigint;
  pnlPercent: number;
  quoteDecimals: number;
  quoteToken: Erc20TokenResponse;
}

export function PnLCurveTooltip({
  price,
  positionValue,
  pnl,
  pnlPercent,
  quoteDecimals,
  quoteToken,
}: PnLCurveTooltipProps) {
  return (
    <div className="bg-slate-800/95 border border-slate-700 rounded-lg p-3 shadow-xl backdrop-blur-sm">
      <p className="text-slate-300 text-sm">
        <strong>Price:</strong>{" "}
        {formatCompactValue(price, quoteDecimals)}{" "}
        {quoteToken.symbol}
      </p>
      <p className="text-slate-300 text-sm">
        <strong>Position Value:</strong>{" "}
        {formatCompactValue(positionValue, quoteDecimals)}{" "}
        {quoteToken.symbol}
      </p>
      <p
        className={`text-sm font-medium ${
          pnl >= 0n ? "text-green-400" : "text-red-400"
        }`}
      >
        <strong>PnL:</strong>{" "}
        {formatCompactValue(pnl, quoteDecimals)}{" "}
        {quoteToken.symbol} ({formatPercentage(pnlPercent, 2)})
      </p>
    </div>
  );
}
