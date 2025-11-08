"use client";

import { formatCompactValue } from "@/lib/fraction-format";

interface PnLBreakdownProps {
  currentValue: string;
  currentCostBasis: string;
  collectedFees: string;
  unclaimedFees: string;
  realizedPnL: string;
  quoteTokenSymbol: string;
  quoteTokenDecimals: number;
}

export function PnLBreakdown({
  currentValue,
  currentCostBasis,
  collectedFees,
  unclaimedFees,
  realizedPnL,
  quoteTokenSymbol,
  quoteTokenDecimals,
}: PnLBreakdownProps) {
  // Calculate breakdown values
  const realizedPnLAmount = BigInt(realizedPnL) + BigInt(collectedFees);
  const unrealizedPnLAmount =
    BigInt(unclaimedFees) + (BigInt(currentValue) - BigInt(currentCostBasis));
  const totalPnLAmount = realizedPnLAmount + unrealizedPnLAmount;

  const realizedColor =
    realizedPnLAmount > 0n
      ? "text-green-400"
      : realizedPnLAmount < 0n
        ? "text-red-400"
        : "text-slate-400";
  const unrealizedColor =
    unrealizedPnLAmount > 0n
      ? "text-green-400"
      : unrealizedPnLAmount < 0n
        ? "text-red-400"
        : "text-slate-400";
  const totalColor =
    totalPnLAmount > 0n
      ? "text-green-400"
      : totalPnLAmount < 0n
        ? "text-red-400"
        : "text-slate-400";

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
      <h3 className="text-lg font-semibold text-white mb-6">PnL Breakdown</h3>

      <div className="space-y-6">
        {/* Total PnL at top */}
        <div className="border-b border-slate-600/50 pb-4">
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold text-slate-300">
              Total PnL
            </span>
            <span className={`text-xl font-bold ${totalColor}`}>
              {formatCompactValue(totalPnLAmount, quoteTokenDecimals)}{" "}
              {quoteTokenSymbol}
            </span>
          </div>
        </div>

        {/* Two Column Layout for Realized and Unrealized PnL */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Realized PnL Column */}
          <div className="space-y-3">
            <h4 className="text-md font-semibold text-white">Realized PnL</h4>
            <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">+ Fees Collected</span>
                <span className="text-white font-medium">
                  {formatCompactValue(BigInt(collectedFees), quoteTokenDecimals)}{" "}
                  {quoteTokenSymbol}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">+ Realized PnL*</span>
                <span className="text-white font-medium">
                  {formatCompactValue(BigInt(realizedPnL), quoteTokenDecimals)}{" "}
                  {quoteTokenSymbol}
                </span>
              </div>
              <div className="text-xs text-slate-500 pl-2" style={{ marginTop: "2px" }}>
                *) PnL from already withdrawn assets
              </div>
              <div className="border-t border-slate-600/50 pt-2 mt-2">
                <div className="flex justify-between items-center">
                  <span className="text-white font-medium">= Subtotal</span>
                  <span className={`font-bold ${realizedColor}`}>
                    {formatCompactValue(realizedPnLAmount, quoteTokenDecimals)}{" "}
                    {quoteTokenSymbol}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Unrealized PnL Column */}
          <div className="space-y-3">
            <h4 className="text-md font-semibold text-white">Unrealized PnL</h4>
            <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">+ Unclaimed Fees</span>
                <span className="text-white font-medium">
                  {formatCompactValue(BigInt(unclaimedFees), quoteTokenDecimals)}{" "}
                  {quoteTokenSymbol}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">+ Current Position Value</span>
                <span className="text-white font-medium">
                  {formatCompactValue(BigInt(currentValue), quoteTokenDecimals)}{" "}
                  {quoteTokenSymbol}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">- Cost Basis</span>
                <span className="text-white font-medium">
                  -{formatCompactValue(BigInt(currentCostBasis), quoteTokenDecimals)}{" "}
                  {quoteTokenSymbol}
                </span>
              </div>
              <div className="border-t border-slate-600/50 pt-2 mt-2">
                <div className="flex justify-between items-center">
                  <span className="text-white font-medium">= Subtotal</span>
                  <span className={`font-bold ${unrealizedColor}`}>
                    {formatCompactValue(unrealizedPnLAmount, quoteTokenDecimals)}{" "}
                    {quoteTokenSymbol}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
