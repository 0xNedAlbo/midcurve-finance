/**
 * Strategy Detail Header
 *
 * Header component for strategy detail pages with:
 * - Strategy name and quote token logo
 * - Status and type badges
 * - Chain badge with explorer link
 * - Contract address with copy/link buttons
 * - Summary metrics cards
 * - Back navigation
 * - Refresh button
 * - Start/Shutdown lifecycle buttons
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Copy,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  Wallet,
  BarChart3,
  Layers,
  Play,
  Power,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getDashboardUrl } from "@/lib/dashboard-referrer";
import type { ListStrategyData } from "@midcurve/api-shared";
import { StrategyLifecycleModal } from "./strategy-lifecycle-modal";

// Chain metadata for display
const CHAIN_METADATA: Record<number, { name: string; explorer: string }> = {
  1: { name: "Ethereum", explorer: "https://etherscan.io" },
  42161: { name: "Arbitrum", explorer: "https://arbiscan.io" },
  8453: { name: "Base", explorer: "https://basescan.org" },
  56: { name: "BSC", explorer: "https://bscscan.com" },
  137: { name: "Polygon", explorer: "https://polygonscan.com" },
  10: { name: "Optimism", explorer: "https://optimistic.etherscan.io" },
};

// Status colors
const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  deploying: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  deployed: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  starting: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  active: "text-green-400 bg-green-500/10 border-green-500/20",
  shutting_down: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  shutdown: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

interface StrategyDetailHeaderProps {
  strategy: ListStrategyData;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

export function StrategyDetailHeader({
  strategy,
  onRefresh,
  isRefreshing,
}: StrategyDetailHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [lifecycleModal, setLifecycleModal] = useState<"start" | "shutdown" | null>(null);

  const chainMeta = strategy.chainId ? CHAIN_METADATA[strategy.chainId] : null;
  const statusColor = STATUS_COLORS[strategy.status] || STATUS_COLORS.pending;

  // Parse metrics
  const value = BigInt(strategy.metrics.currentValue);
  const costBasis = BigInt(strategy.metrics.currentCostBasis);
  const realizedCap = BigInt(strategy.metrics.realizedCapitalGain);
  const realizedInc = BigInt(strategy.metrics.realizedIncome);
  const unrealizedInc = BigInt(strategy.metrics.unrealizedIncome);
  const exp = BigInt(strategy.metrics.expenses);

  // Calculate derived metrics
  const unrealizedCapitalGain = value - costBasis;
  const totalUnrealizedPnl = unrealizedCapitalGain + unrealizedInc;
  const totalRealizedPnl = realizedCap + realizedInc - exp;
  const totalPnl = totalUnrealizedPnl + totalRealizedPnl;

  // Format value with token decimals
  const decimals = strategy.quoteToken?.decimals ?? 6;
  const symbol = strategy.quoteToken?.symbol ?? "USD";

  const formatValue = (val: bigint): string => {
    const divisor = BigInt(10 ** decimals);
    const wholePart = val / divisor;
    const fractionalPart = val % divisor;

    // Handle negative values
    const isNegative = val < 0n;
    const absWhole = isNegative ? -wholePart : wholePart;
    const absFrac = isNegative ? -fractionalPart : fractionalPart;

    // Format with 2 decimal places for display
    const fracStr = absFrac.toString().padStart(decimals, "0").slice(0, 2);

    return `${isNegative ? "-" : ""}${absWhole.toLocaleString()}.${fracStr}`;
  };

  // Determine PnL trend
  const pnlTrend =
    totalPnl > 0n ? "positive" : totalPnl < 0n ? "negative" : "neutral";

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Format age
  const age = formatDistanceToNow(new Date(strategy.createdAt), {
    addSuffix: true,
  });

  return (
    <div className="mb-8">
      {/* Back Navigation */}
      <div className="mb-6">
        <Link
          to={getDashboardUrl()}
          className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>

      {/* Main Header */}
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 px-8 py-6">
        <div className="flex items-start justify-between">
          {/* Left Side - Strategy Info */}
          <div className="flex items-center gap-6">
            {/* Quote Token Logo or Default Icon */}
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-700 border-2 border-slate-600">
              {strategy.quoteToken?.logoUrl ? (
                <img
                  src={strategy.quoteToken.logoUrl}
                  alt={strategy.quoteToken.symbol}
                  className="w-10 h-10 rounded-full"
                />
              ) : (
                <Layers className="w-6 h-6 text-slate-400" />
              )}
            </div>

            {/* Strategy Info */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-white">
                  {strategy.name}
                </h1>
                <span
                  className={`px-3 py-1 rounded-lg text-sm font-medium border ${statusColor}`}
                >
                  {strategy.status.replace("_", " ")}
                </span>
              </div>

              <div className="flex items-center gap-4 text-sm text-slate-400">
                {/* Strategy Type */}
                <span className="px-2 py-1 rounded bg-slate-700/50 text-slate-300">
                  {strategy.strategyType}
                </span>

                {/* Chain */}
                {chainMeta && (
                  <>
                    <span>•</span>
                    <span className="px-2 py-1 rounded bg-slate-500/20 border border-slate-500/30 text-slate-300">
                      {chainMeta.name}
                    </span>
                  </>
                )}

                {/* Contract Address */}
                {strategy.contractAddress && (
                  <>
                    <span>•</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">
                        {strategy.contractAddress.slice(0, 6)}...
                        {strategy.contractAddress.slice(-4)}
                      </span>
                      <button
                        onClick={() =>
                          copyToClipboard(strategy.contractAddress || "")
                        }
                        className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
                        title="Copy Address"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      {chainMeta && (
                        <a
                          href={`${chainMeta.explorer}/address/${strategy.contractAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
                          title="View on Explorer"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {copied && (
                        <div className="absolute mt-8 bg-green-600 text-white text-xs px-2 py-1 rounded shadow-lg z-20">
                          Copied!
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Age */}
                <span>•</span>
                <span>Created {age}</span>
              </div>
            </div>
          </div>

          {/* Right Side - Actions */}
          <div className="flex items-center gap-3">
            {/* Lifecycle Actions */}
            {strategy.status === "deployed" && strategy.contractAddress && (
              <button
                onClick={() => setLifecycleModal("start")}
                className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors cursor-pointer flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                Start
              </button>
            )}

            {strategy.status === "active" && strategy.contractAddress && (
              <button
                onClick={() => setLifecycleModal("shutdown")}
                className="px-4 py-2 text-sm font-medium bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors cursor-pointer flex items-center gap-2"
              >
                <Power className="w-4 h-4" />
                Shutdown
              </button>
            )}

            {/* Last Updated */}
            {strategy.updatedAt && (
              <div className="text-right text-sm text-slate-400">
                <div>Last Updated</div>
                <div>{new Date(strategy.updatedAt).toLocaleString()}</div>
              </div>
            )}

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-3 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              title="Refresh"
            >
              <RefreshCw
                className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Metrics Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
          {/* Current Value */}
          <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Wallet className="w-5 h-5 text-blue-400" />
              </div>
              <span className="text-sm text-slate-400">Current Value</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {formatValue(value)} {symbol}
            </div>
          </div>

          {/* Total PnL */}
          <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="flex items-center gap-3 mb-2">
              <div
                className={`p-2 rounded-lg ${
                  pnlTrend === "positive"
                    ? "bg-green-500/20"
                    : pnlTrend === "negative"
                    ? "bg-red-500/20"
                    : "bg-slate-500/20"
                }`}
              >
                {pnlTrend === "positive" ? (
                  <TrendingUp className="w-5 h-5 text-green-400" />
                ) : pnlTrend === "negative" ? (
                  <TrendingDown className="w-5 h-5 text-red-400" />
                ) : (
                  <Minus className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <span className="text-sm text-slate-400">Total PnL</span>
            </div>
            <div
              className={`text-2xl font-bold ${
                pnlTrend === "positive"
                  ? "text-green-400"
                  : pnlTrend === "negative"
                  ? "text-red-400"
                  : "text-slate-400"
              }`}
            >
              {totalPnl >= 0n ? "+" : ""}
              {formatValue(totalPnl)} {symbol}
            </div>
          </div>

          {/* Position Count */}
          <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <BarChart3 className="w-5 h-5 text-purple-400" />
              </div>
              <span className="text-sm text-slate-400">Positions</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {strategy.positionCount}
            </div>
          </div>
        </div>
      </div>

      {/* Lifecycle Modal */}
      {lifecycleModal && (
        <StrategyLifecycleModal
          isOpen={!!lifecycleModal}
          onClose={() => setLifecycleModal(null)}
          strategy={strategy}
          action={lifecycleModal}
          onSuccess={async () => {
            setLifecycleModal(null);
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}
