/**
 * StrategyPositionsList - Collapsible list of strategy's child positions
 */

import type { StrategyPositionJSON } from "@midcurve/shared";

// Position type colors
const POSITION_TYPE_COLORS: Record<string, string> = {
  treasury: "bg-amber-500/20 text-amber-400",
  uniswapv3: "bg-purple-500/20 text-purple-400",
  hyperliquid: "bg-blue-500/20 text-blue-400",
};

// Position status colors
const POSITION_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  active: "bg-green-500/20 text-green-400",
  paused: "bg-orange-500/20 text-orange-400",
  closed: "bg-slate-500/20 text-slate-400",
};

interface StrategyPositionsListProps {
  positions: StrategyPositionJSON[];
}

export function StrategyPositionsList({ positions }: StrategyPositionsListProps) {
  if (positions.length === 0) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-700/50">
        <div className="text-xs text-slate-500 text-center py-2">
          No positions
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-700/50">
      <div className="text-xs text-slate-400 mb-2">
        {positions.length} Position{positions.length !== 1 ? "s" : ""}
      </div>
      <div className="space-y-2">
        {positions.map((position) => (
          <StrategyPositionRow key={position.id} position={position} />
        ))}
      </div>
    </div>
  );
}

function StrategyPositionRow({ position }: { position: StrategyPositionJSON }) {
  const typeColor =
    POSITION_TYPE_COLORS[position.positionType] || POSITION_TYPE_COLORS.treasury;
  const statusColor =
    POSITION_STATUS_COLORS[position.status] || POSITION_STATUS_COLORS.pending;

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-slate-800/50 rounded-lg">
      {/* Position type badge */}
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${typeColor}`}>
        {position.positionType}
      </span>

      {/* Status badge */}
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor}`}>
        {position.status}
      </span>

      {/* Position ID (truncated) */}
      <span className="text-xs text-slate-500 font-mono">
        {position.id.slice(0, 8)}...
      </span>

      {/* Opened date */}
      {position.openedAt && (
        <span className="text-xs text-slate-500 ml-auto">
          {new Date(position.openedAt).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}
