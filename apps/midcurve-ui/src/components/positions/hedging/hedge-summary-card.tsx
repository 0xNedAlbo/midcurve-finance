"use client";

import type { HyperliquidPerpHedge } from "@midcurve/shared";
import { Shield, TrendingDown, ExternalLink } from "lucide-react";

interface HedgeSummaryCardProps {
  hedge: HyperliquidPerpHedge;
}

export function HedgeSummaryCard({ hedge }: HedgeSummaryCardProps) {
  const { config, state } = hedge;
  const position = state.position;

  // Get status badge styling
  const getStatusBadge = () => {
    switch (state.positionStatus) {
      case "open":
        return { label: "Active", className: "bg-green-500/20 text-green-400" };
      case "closing":
        return { label: "Closing", className: "bg-amber-500/20 text-amber-400" };
      case "closed":
        return { label: "Closed", className: "bg-slate-500/20 text-slate-400" };
      case "liquidated":
        return { label: "Liquidated", className: "bg-red-500/20 text-red-400" };
      default:
        return { label: "No Position", className: "bg-slate-500/20 text-slate-400" };
    }
  };

  const statusBadge = getStatusBadge();

  // Format price values
  const formatPrice = (price: string | undefined) => {
    if (!price) return "-";
    const num = parseFloat(price);
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Format size values
  const formatSize = (size: string | undefined) => {
    if (!size) return "-";
    const num = parseFloat(size);
    return num.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Shield className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Hyperliquid Perpetual Short</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-slate-400">
                {config.market.coin}/{config.market.quote}
              </span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusBadge.className}`}>
                {statusBadge.label}
              </span>
            </div>
          </div>
        </div>

        {/* Hyperliquid Link */}
        <a
          href={`https://app.hyperliquid.xyz/trade/${config.market.coin}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
        >
          View on Hyperliquid
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Position Details Grid */}
      {position ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Position Size */}
          <div className="p-3 bg-slate-700/30 rounded-lg">
            <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
              <TrendingDown className="w-3 h-3" />
              Position Size
            </div>
            <div className="text-lg font-semibold text-white">
              {formatSize(position.absSize)} {config.market.coin}
            </div>
            <div className="text-xs text-red-400 mt-0.5">
              Short Position
            </div>
          </div>

          {/* Entry Price */}
          <div className="p-3 bg-slate-700/30 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Entry Price</div>
            <div className="text-lg font-semibold text-white">
              {formatPrice(position.entryPx)}
            </div>
          </div>

          {/* Current Price */}
          <div className="p-3 bg-slate-700/30 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Mark Price</div>
            <div className="text-lg font-semibold text-white">
              {formatPrice(position.markPx)}
            </div>
            {position.entryPx && position.markPx && (
              <div className={`text-xs mt-0.5 ${
                parseFloat(position.markPx) < parseFloat(position.entryPx)
                  ? "text-green-400"
                  : parseFloat(position.markPx) > parseFloat(position.entryPx)
                    ? "text-red-400"
                    : "text-slate-400"
              }`}>
                {parseFloat(position.markPx) < parseFloat(position.entryPx) ? "↓" : "↑"}
                {Math.abs(
                  ((parseFloat(position.markPx) - parseFloat(position.entryPx)) /
                    parseFloat(position.entryPx)) *
                    100
                ).toFixed(2)}%
              </div>
            )}
          </div>

          {/* Liquidation Price */}
          <div className="p-3 bg-slate-700/30 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Liquidation Price</div>
            <div className="text-lg font-semibold text-amber-400">
              {formatPrice(position.liquidationPx)}
            </div>
            {position.markPx && position.liquidationPx && (
              <div className="text-xs text-slate-500 mt-0.5">
                {(
                  ((parseFloat(position.liquidationPx) - parseFloat(position.markPx)) /
                    parseFloat(position.markPx)) *
                  100
                ).toFixed(1)}% away
              </div>
            )}
          </div>

          {/* Leverage */}
          <div className="p-3 bg-slate-700/30 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Leverage</div>
            <div className="text-lg font-semibold text-white">
              {position.leverage.value}x
            </div>
            <div className="text-xs text-slate-500 mt-0.5 capitalize">
              {position.leverage.mode} margin
            </div>
          </div>

          {/* Margin Used */}
          <div className="p-3 bg-slate-700/30 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Margin Used</div>
            <div className="text-lg font-semibold text-white">
              ${parseFloat(position.leverage.marginUsed).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          {/* Unrealized PnL */}
          <div className="p-3 bg-slate-700/30 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Unrealized PnL</div>
            <div className={`text-lg font-semibold ${
              parseFloat(position.value.unrealizedPnl) >= 0
                ? "text-green-400"
                : "text-red-400"
            }`}>
              {parseFloat(position.value.unrealizedPnl) >= 0 ? "+" : ""}
              ${parseFloat(position.value.unrealizedPnl).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          {/* ROE */}
          <div className="p-3 bg-slate-700/30 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Return on Equity</div>
            <div className={`text-lg font-semibold ${
              position.value.returnOnEquity && parseFloat(position.value.returnOnEquity) >= 0
                ? "text-green-400"
                : "text-red-400"
            }`}>
              {position.value.returnOnEquity
                ? `${(parseFloat(position.value.returnOnEquity) * 100).toFixed(2)}%`
                : "-"}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-slate-400">
          No active position on Hyperliquid
        </div>
      )}

      {/* Subaccount Info */}
      {config.account.subAccountName && (
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Subaccount</span>
            <span className="font-mono text-slate-300">{config.account.subAccountName}</span>
          </div>
        </div>
      )}
    </div>
  );
}
