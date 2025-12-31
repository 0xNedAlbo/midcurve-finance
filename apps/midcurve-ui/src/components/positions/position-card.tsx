import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import type { ListPositionData } from "@midcurve/api-shared";
import { PositionCardHeader } from "./position-card-header";
import { PositionCardMetrics } from "./position-card-metrics";
import { UniswapV3Identifier } from "./protocol/uniswapv3/uniswapv3-identifier";
import { UniswapV3RangeStatus } from "./protocol/uniswapv3/uniswapv3-range-status";
import { UniswapV3ChainBadge } from "./protocol/uniswapv3/uniswapv3-chain-badge";
import { UniswapV3Actions } from "./protocol/uniswapv3/uniswapv3-actions";
import { UniswapV3MiniPnLCurve } from "./protocol/uniswapv3/uniswapv3-mini-pnl-curve";
import { PositionActionsMenu } from "./position-actions-menu";
import { DeletePositionModal } from "./delete-position-modal";
import { ReloadHistoryModal } from "./reload-history-modal";
import { useIsDeletingPosition } from "@/hooks/positions/useDeletePosition";
import { useIsReloadingPositionHistory } from "@/hooks/positions/useReloadPositionHistory";
import { useRefreshPosition } from "@/hooks/positions/useRefreshPosition";
import { usePositionDetail } from "@/hooks/positions/usePositionDetail";
import { getChainSlugByChainId } from "@/config/chains";

interface PositionCardProps {
  initialData: ListPositionData;
  listIndex: number; // Used for staggered initial refresh
}

export function PositionCard({ initialData, listIndex }: PositionCardProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReloadHistoryModal, setShowReloadHistoryModal] = useState(false);

  // Extract protocol-specific identifiers for detail query
  const protocol = initialData.protocol;
  const config =
    protocol === "uniswapv3"
      ? (initialData.config as { chainId: number; nftId: number })
      : undefined;

  // Fetch fresh position data from detail endpoint
  // Shows initialData immediately, then updates with fresh data when loaded
  const { data: position = initialData, refetch } = usePositionDetail({
    protocol,
    chainId: config?.chainId,
    nftId: config?.nftId?.toString(),
    initialData,
  });

  // Staggered initial refresh on mount
  // Each card refreshes with a delay of listIndex * 2 seconds
  // This prevents API rate limiting and spreads server load
  useEffect(() => {
    const delay = listIndex * 2000; // 2 seconds per position index
    const timeoutId = setTimeout(() => {
      refetch();
    }, delay);

    // Cleanup: clear timeout if component unmounts before refresh
    return () => clearTimeout(timeoutId);
  }, [listIndex, refetch]);

  // Check if this specific position is being deleted
  const isDeleting = useIsDeletingPosition(position.id);

  // Check if this specific position's history is being reloaded
  const isReloadingHistory = useIsReloadingPositionHistory(position.id);

  // Refresh mutation
  const refreshMutation = useRefreshPosition();

  // Extract common data (works for ALL protocols)
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;

  // Calculate in-range status (protocol-agnostic dispatcher)
  const isInRange = calculateIsInRange(position);

  // Manual refresh handler - triggers mutation to force immediate refresh
  const handleRefresh = () => {
    switch (position.protocol) {
      case "uniswapv3": {
        const config = position.config as {
          chainId: number;
          nftId: number;
        };
        refreshMutation.mutate({
          protocol: "uniswapv3",
          chainId: config.chainId,
          nftId: String(config.nftId),
        });
        break;
      }
      // Future protocols can be added here
      default:
        console.warn(`Refresh not implemented for protocol: ${position.protocol}`);
    }
  };

  // Note: Auto-refresh is handled by usePositionDetail hook (refetchInterval: 60s)
  // No need for manual timer here

  return (
    <div className="bg-gradient-to-br from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-xl p-3 md:p-4 lg:p-6 hover:border-slate-600/50 transition-all duration-200">
      <div className="flex items-center gap-2 md:gap-3">
        {/* LEFT: Header (protocol-agnostic with protocol-specific slots) */}
        <PositionCardHeader
          baseToken={baseToken}
          quoteToken={quoteToken}
          status={position.isActive ? "active" : "closed"}
          protocol={position.protocol}
          positionOpenedAt={position.positionOpenedAt}
          statusLineBadges={
            position.protocol === "uniswapv3" ? (
              <UniswapV3RangeStatus position={position} />
            ) : null
          }
          protocolLineBadges={
            position.protocol === "uniswapv3" ? (
              <>
                <UniswapV3ChainBadge position={position} />
                <UniswapV3Identifier position={position} />
              </>
            ) : null
          }
        />

        {/* MIDDLE: Metrics (protocol-agnostic) - grouped with consistent gaps */}
        <PositionCardMetrics
          currentValue={position.currentValue}
          realizedPnl={position.realizedPnl}
          unrealizedPnl={position.unrealizedPnl}
          unClaimedFees={position.unClaimedFees}
          collectedFees={position.collectedFees}
          currentCostBasis={position.currentCostBasis}
          lastFeesCollectedAt={position.lastFeesCollectedAt}
          positionOpenedAt={position.positionOpenedAt}
          quoteToken={quoteToken}
          isActive={position.isActive}
          isInRange={isInRange}
          totalApr={position.totalApr}
          pnlCurveSlot={
            position.protocol === "uniswapv3" ? (
              <UniswapV3MiniPnLCurve position={position} />
            ) : null
          }
        />

        {/* RIGHT: Common Actions - pushed to the right with ml-auto */}
        <div className="flex items-center gap-1 md:gap-2 ml-auto">
          <Link
            to={`/positions/${position.protocol}/${getPositionPath(position)}`}
            onClick={() => {
              // Store current dashboard URL for back navigation
              const currentUrl = window.location.pathname + window.location.search;
              import("@/lib/dashboard-referrer").then(({ storeDashboardUrl }) => {
                storeDashboardUrl(currentUrl);
              });
            }}
            className="p-1.5 md:p-2 hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            title="View Details"
          >
            <Search className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" />
          </Link>
          <button
            onClick={handleRefresh}
            disabled={refreshMutation.isPending}
            className="p-1.5 md:p-2 hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400 ${
                refreshMutation.isPending ? "animate-spin" : ""
              }`}
            />
          </button>
          <PositionActionsMenu
            onReloadHistory={() => setShowReloadHistoryModal(true)}
            onDelete={() => setShowDeleteModal(true)}
            isDeleting={isDeleting}
            isReloadingHistory={isReloadingHistory}
          />
        </div>
      </div>

      {/* Action Buttons Row (protocol-specific) */}
      {position.protocol === "uniswapv3" && (
        <UniswapV3Actions position={position} isInRange={isInRange} />
      )}
      {/* Future: Orca, other protocols */}

      {/* Reload History Modal */}
      <ReloadHistoryModal
        isOpen={showReloadHistoryModal}
        onClose={() => setShowReloadHistoryModal(false)}
        position={position}
        onReloadSuccess={() => {
          // Modal closes automatically after cache invalidation completes
        }}
      />

      {/* Delete Position Modal */}
      <DeletePositionModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        position={position}
        onDeleteSuccess={() => {
          // Modal closes automatically after cache invalidation completes
        }}
      />
    </div>
  );
}

// Protocol-agnostic helper functions
function calculateIsInRange(position: ListPositionData): boolean {
  if (!position.isActive) return false;

  switch (position.protocol) {
    case "uniswapv3": {
      const config = position.config as {
        tickLower: number;
        tickUpper: number;
      };
      const poolState = position.pool.state as {
        currentTick: number;
      };
      return (
        poolState.currentTick >= config.tickLower &&
        poolState.currentTick <= config.tickUpper
      );
    }
    // Future: Add Orca, other protocols
    default:
      return false;
  }
}

function getPositionPath(position: ListPositionData): string {
  switch (position.protocol) {
    case "uniswapv3": {
      const config = position.config as {
        chainId: number;
        nftId: number;
      };
      const chainSlug = getChainSlugByChainId(config.chainId);
      if (!chainSlug) {
        console.warn(`Unknown chainId: ${config.chainId}`);
        return position.id;
      }
      return `${chainSlug}/${config.nftId}`;
    }
    // Future: Add Orca, other protocols
    default:
      return position.id;
  }
}
