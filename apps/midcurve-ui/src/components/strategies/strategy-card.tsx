/**
 * StrategyCard - Displays a single strategy with aggregated metrics
 *
 * Shows:
 * - Strategy name and type
 * - Status badge (pending, active, shutdown, etc.)
 * - Aggregated metrics (total value, total PnL, position count)
 * - Collapsible list of child positions
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import type { ListStrategyData } from "@midcurve/api-shared";
import { StrategyCardHeader } from "./strategy-card-header";
import { StrategyCardMetrics } from "./strategy-card-metrics";
import { StrategyPositionsList } from "./strategy-positions-list";

interface StrategyCardProps {
  strategy: ListStrategyData;
  listIndex: number;
}

export function StrategyCard({ strategy }: StrategyCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if we have positions data to show
  const hasPositions =
    strategy.strategyPositions && strategy.strategyPositions.length > 0;

  return (
    <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-xl p-3 md:p-4 lg:p-6 hover:border-slate-600/50 transition-all duration-200">
      {/* Main Row */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* LEFT: Header */}
        <StrategyCardHeader
          name={strategy.name}
          strategyType={strategy.strategyType}
          status={strategy.status}
          quoteToken={strategy.quoteToken as any}
          chainId={strategy.chainId}
          contractAddress={strategy.contractAddress}
          createdAt={strategy.createdAt}
        />

        {/* MIDDLE: Metrics */}
        <StrategyCardMetrics
          currentValue={strategy.metrics.currentValue}
          currentCostBasis={strategy.metrics.currentCostBasis}
          realizedCapitalGain={strategy.metrics.realizedCapitalGain}
          realizedIncome={strategy.metrics.realizedIncome}
          unrealizedIncome={strategy.metrics.unrealizedIncome}
          expenses={strategy.metrics.expenses}
          quoteToken={strategy.quoteToken as any}
          positionCount={strategy.positionCount}
        />

        {/* RIGHT: Actions */}
        <div className="flex items-center gap-1 md:gap-2 ml-auto">
          {/* Expand/Collapse positions (only if positions data is available) */}
          {hasPositions && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 md:p-2 hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
              title={isExpanded ? "Collapse positions" : "Show positions"}
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          )}

          {/* View Details */}
          <Link
            to={`/strategies/${strategy.id}`}
            className="p-1.5 md:p-2 hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            title="View Details"
          >
            <Search className="w-4 h-4 text-slate-400" />
          </Link>
        </div>
      </div>

      {/* Collapsible Positions Section */}
      {isExpanded && strategy.strategyPositions && (
        <StrategyPositionsList positions={strategy.strategyPositions} />
      )}
    </div>
  );
}
