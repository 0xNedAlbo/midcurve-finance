/**
 * UniswapV3PositionCard - Self-sufficient position card for Uniswap V3
 *
 * This component is responsible for its own data lifecycle:
 * 1. Shows skeleton layout matching final dimensions
 * 2. Fetches detail data via useUniswapV3Position hook (3s DB polling)
 * 3. Triggers on-chain refresh via useUniswapV3AutoRefresh (60s)
 * 4. Patches live pool price via useUniswapV3LiveMetrics (5s)
 * 5. Renders header, metrics, PnL curve, and action buttons
 *
 * Props are just chainId + nftId — all other data is fetched internally.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import { PositionCardHeader } from "../../position-card-header";
import { PositionCardMetrics } from "../../position-card-metrics";
import { UniswapV3Identifier } from "./uniswapv3-identifier";
import { UniswapV3RangeStatus } from "./uniswapv3-range-status";
import { UniswapV3ChainBadge } from "./uniswapv3-chain-badge";
import { UniswapV3Actions } from "./uniswapv3-actions";
import { UniswapV3MiniPnLCurve } from "./uniswapv3-mini-pnl-curve";
import { PositionActionsMenu } from "../../position-actions-menu";
import { UniswapV3DeletePositionModal } from "./uniswapv3-delete-position-modal";
import { UniswapV3ReloadHistoryModal } from "./uniswapv3-reload-history-modal";
import { UniswapV3SwitchQuoteTokenModal } from "./uniswapv3-switch-quote-token-modal";
import { useIsMutating } from "@tanstack/react-query";
import { deletePositionMutationKey } from "@/hooks/positions/useDeletePosition";
import { reloadPositionHistoryMutationKey } from "@/hooks/positions/useReloadPositionHistory";
import { switchQuoteTokenMutationKey } from "@/hooks/positions/useSwitchQuoteToken";
import { useUniswapV3RefreshPosition } from "@/hooks/positions/uniswapv3/useUniswapV3RefreshPosition";
import { useUniswapV3AutoRefresh } from "@/hooks/positions/uniswapv3/useUniswapV3AutoRefresh";
import { useUniswapV3Position } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import { useUniswapV3LiveMetrics } from "@/hooks/positions/uniswapv3/useUniswapV3LiveMetrics";
import { getChainSlugByChainId } from "@/config/chains";

interface UniswapV3PositionCardProps {
  chainId: number;
  nftId: number;
  index?: number;
}

export function UniswapV3PositionCard({ chainId, nftId, index = 0 }: UniswapV3PositionCardProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReloadHistoryModal, setShowReloadHistoryModal] = useState(false);
  const [showSwitchQuoteTokenModal, setShowSwitchQuoteTokenModal] = useState(false);

  const isAlt = index % 2 === 1;

  // Fetch position detail (auto-refreshes every 60s)
  const { data: position, isLoading } = useUniswapV3Position(chainId, String(nftId));

  // Show skeleton while loading
  if (isLoading || !position) {
    return <UniswapV3PositionCardSkeleton isAlt={isAlt} />;
  }

  return (
    <UniswapV3PositionCardLoaded
      position={position}
      chainId={chainId}
      nftId={nftId}
      isAlt={isAlt}
      showDeleteModal={showDeleteModal}
      setShowDeleteModal={setShowDeleteModal}
      showReloadHistoryModal={showReloadHistoryModal}
      setShowReloadHistoryModal={setShowReloadHistoryModal}
      showSwitchQuoteTokenModal={showSwitchQuoteTokenModal}
      setShowSwitchQuoteTokenModal={setShowSwitchQuoteTokenModal}
    />
  );
}

// =============================================================================
// Loaded Card
// =============================================================================

interface UniswapV3PositionCardLoadedProps {
  position: UniswapV3PositionData;
  chainId: number;
  nftId: number;
  isAlt: boolean;
  showDeleteModal: boolean;
  setShowDeleteModal: (show: boolean) => void;
  showReloadHistoryModal: boolean;
  setShowReloadHistoryModal: (show: boolean) => void;
  showSwitchQuoteTokenModal: boolean;
  setShowSwitchQuoteTokenModal: (show: boolean) => void;
}

function UniswapV3PositionCardLoaded({
  position: rawPosition,
  chainId,
  nftId,
  isAlt,
  showDeleteModal,
  setShowDeleteModal,
  showReloadHistoryModal,
  setShowReloadHistoryModal,
  showSwitchQuoteTokenModal,
  setShowSwitchQuoteTokenModal,
}: UniswapV3PositionCardLoadedProps) {
  // Patch live pool price into position data (5s polling)
  const position = useUniswapV3LiveMetrics(rawPosition);

  // On-chain refresh on mount + every 60s (fire-and-forget, DB polling picks up changes)
  const { isRefreshing: isAutoRefreshing } = useUniswapV3AutoRefresh(chainId, String(nftId));

  const isDeleting = useIsMutating({ mutationKey: deletePositionMutationKey(position.positionHash) }) > 0;
  const isReloadingHistory = useIsMutating({ mutationKey: reloadPositionHistoryMutationKey(position.positionHash) }) > 0;
  const isSwitchingQuoteToken = useIsMutating({ mutationKey: switchQuoteTokenMutationKey(position.positionHash) }) > 0;
  const refreshMutation = useUniswapV3RefreshPosition();
  const isRefreshing = isAutoRefreshing || refreshMutation.isPending;

  // Extract token roles
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;

  // Calculate in-range status
  const config = position.config as { tickLower: number; tickUpper: number };
  const poolState = position.pool.state as { currentTick: number };
  const isInRange = position.isActive &&
    poolState.currentTick >= config.tickLower &&
    poolState.currentTick <= config.tickUpper;

  // Detail page path
  const chainSlug = getChainSlugByChainId(chainId);
  const detailPath = chainSlug
    ? `/positions/uniswapv3/${chainSlug}/${nftId}`
    : `/positions/uniswapv3/${chainId}/${nftId}`;

  const handleRefresh = () => {
    refreshMutation.mutate({
      chainId,
      nftId: String(nftId),
    });
  };

  return (
    <div className={`${isAlt ? "bg-gradient-to-br from-slate-800/90 to-slate-700/90" : "bg-gradient-to-br from-slate-900/90 to-slate-800/90"} backdrop-blur-sm border border-slate-700/50 rounded-xl p-3 md:p-4 lg:p-6 hover:border-slate-600/50 transition-all duration-200`}>
      <div className="flex items-center gap-2 md:gap-3">
        {/* LEFT: Header */}
        <PositionCardHeader
          baseToken={baseToken}
          quoteToken={quoteToken}
          status={position.isActive ? "active" : "closed"}
          protocol={position.protocol}
          positionOpenedAt={position.positionOpenedAt}
          statusLineBadges={<UniswapV3RangeStatus position={position} />}
          protocolLineBadges={
            <>
              <UniswapV3ChainBadge position={position} />
              <UniswapV3Identifier position={position} />
            </>
          }
        />

        {/* MIDDLE: Metrics */}
        <PositionCardMetrics
          currentValue={position.currentValue}
          realizedPnl={position.realizedPnl}
          unrealizedPnl={position.unrealizedPnl}
          unClaimedFees={position.unClaimedFees}
          currentCostBasis={position.currentCostBasis}
          lastFeesCollectedAt={position.lastFeesCollectedAt}
          positionOpenedAt={position.positionOpenedAt}
          quoteToken={quoteToken}
          isActive={position.isActive}
          isInRange={isInRange}
          totalApr={position.totalApr}
          pnlCurveSlot={<UniswapV3MiniPnLCurve position={position} />}
        />

        {/* RIGHT: Common Actions */}
        <div className="flex items-center gap-1 md:gap-2 ml-auto">
          <Link
            to={detailPath}
            onClick={() => {
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
            disabled={isRefreshing}
            className="p-1.5 md:p-2 hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400 ${
                isRefreshing ? "animate-spin" : ""
              }`}
            />
          </button>
          <PositionActionsMenu
            onReloadHistory={() => setShowReloadHistoryModal(true)}
            onSwitchQuoteToken={() => setShowSwitchQuoteTokenModal(true)}
            onDelete={() => setShowDeleteModal(true)}
            isDeleting={isDeleting}
            isReloadingHistory={isReloadingHistory}
            isSwitchingQuoteToken={isSwitchingQuoteToken}
          />
        </div>
      </div>

      {/* Action Buttons Row */}
      <UniswapV3Actions position={position} isInRange={isInRange} />

      {/* Reload History Modal */}
      <UniswapV3ReloadHistoryModal
        isOpen={showReloadHistoryModal}
        onClose={() => setShowReloadHistoryModal(false)}
        onReloadSuccess={() => {}}
        positionHash={position.positionHash}
        chainId={chainId}
        nftId={nftId}
        token0Symbol={position.pool.token0.symbol}
        token1Symbol={position.pool.token1.symbol}
        feeBps={position.pool.feeBps}
      />

      {/* Switch Quote Token Modal */}
      <UniswapV3SwitchQuoteTokenModal
        isOpen={showSwitchQuoteTokenModal}
        onClose={() => setShowSwitchQuoteTokenModal(false)}
        onSwitchSuccess={() => {}}
        positionHash={position.positionHash}
        chainId={chainId}
        nftId={nftId}
        token0Symbol={position.pool.token0.symbol}
        token1Symbol={position.pool.token1.symbol}
        feeBps={position.pool.feeBps}
        isToken0Quote={position.isToken0Quote}
      />

      {/* Delete Position Modal */}
      <UniswapV3DeletePositionModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onDeleteSuccess={() => {}}
        positionHash={position.positionHash}
        chainId={chainId}
        nftId={nftId}
        token0Symbol={position.pool.token0.symbol}
        token1Symbol={position.pool.token1.symbol}
        feeBps={position.pool.feeBps}
      />
    </div>
  );
}

// =============================================================================
// Skeleton
// =============================================================================

function UniswapV3PositionCardSkeleton({ isAlt = false }: { isAlt?: boolean }) {
  return (
    <div className={`${isAlt ? "bg-gradient-to-br from-slate-800/90 to-slate-700/90" : "bg-gradient-to-br from-slate-900/90 to-slate-800/90"} backdrop-blur-sm border border-slate-700/50 rounded-xl p-3 md:p-4 lg:p-6`}>
      <div className="flex items-center gap-2 md:gap-3">
        {/* LEFT: Header skeleton */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Token icons */}
          <div className="flex items-center -space-x-2">
            <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-700/50 animate-pulse border-2 border-slate-700" />
            <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-700/50 animate-pulse border-2 border-slate-700" />
          </div>
          <div className="ml-2 md:ml-3">
            {/* Token pair */}
            <div className="h-5 md:h-6 w-24 bg-slate-700/50 rounded animate-pulse mb-1" />
            {/* Status badges */}
            <div className="flex items-center gap-1 md:gap-2">
              <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse" />
              <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse" />
              <div className="h-4 w-14 bg-slate-700/50 rounded animate-pulse" />
            </div>
            {/* Protocol line */}
            <div className="flex items-center gap-1 md:gap-2 mt-0.5">
              <div className="h-3.5 w-20 bg-slate-700/50 rounded animate-pulse" />
              <div className="h-3.5 w-16 bg-slate-700/50 rounded animate-pulse" />
            </div>
          </div>
        </div>

        {/* MIDDLE: Metrics skeleton */}
        <div className="flex items-center gap-1 md:gap-2 lg:gap-3 xl:gap-4">
          {/* Current Value */}
          <div className="text-right min-w-[80px] md:min-w-[100px] lg:min-w-[120px]">
            <div className="h-3 w-16 bg-slate-700/50 rounded animate-pulse mb-1 ml-auto" />
            <div className="h-5 w-20 bg-slate-700/50 rounded animate-pulse ml-auto" />
          </div>
          {/* PnL Curve */}
          <div className="text-right">
            <div className="h-3 w-14 bg-slate-700/50 rounded animate-pulse mb-1 ml-auto" />
            <div className="w-[80px] h-[40px] md:w-[100px] md:h-[50px] lg:w-[120px] lg:h-[60px] bg-slate-700/30 rounded border border-slate-600/50 animate-pulse" />
          </div>
          {/* Total PnL */}
          <div className="text-right min-w-[80px] md:min-w-[100px] lg:min-w-[120px]">
            <div className="h-3 w-16 bg-slate-700/50 rounded animate-pulse mb-1 ml-auto" />
            <div className="h-5 w-20 bg-slate-700/50 rounded animate-pulse ml-auto" />
          </div>
          {/* Unclaimed Fees */}
          <div className="text-right min-w-[70px] md:min-w-[90px] lg:min-w-[100px]">
            <div className="h-3 w-16 bg-slate-700/50 rounded animate-pulse mb-1 ml-auto" />
            <div className="h-5 w-16 bg-slate-700/50 rounded animate-pulse ml-auto" />
          </div>
          {/* APR */}
          <div className="text-right min-w-[60px] md:min-w-[70px] lg:min-w-[80px]">
            <div className="h-3 w-12 bg-slate-700/50 rounded animate-pulse mb-1 ml-auto" />
            <div className="h-5 w-14 bg-slate-700/50 rounded animate-pulse ml-auto" />
          </div>
        </div>

        {/* RIGHT: Action buttons skeleton */}
        <div className="flex items-center gap-1 md:gap-2 ml-auto">
          <div className="w-8 h-8 bg-slate-700/50 rounded-lg animate-pulse" />
          <div className="w-8 h-8 bg-slate-700/50 rounded-lg animate-pulse" />
          <div className="w-8 h-8 bg-slate-700/50 rounded-lg animate-pulse" />
        </div>
      </div>

      {/* Action Buttons Row skeleton */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-700/50">
        <div className="h-8 w-24 bg-slate-700/50 rounded-lg animate-pulse" />
        <div className="h-8 w-24 bg-slate-700/50 rounded-lg animate-pulse" />
        <div className="h-8 w-28 bg-slate-700/50 rounded-lg animate-pulse" />
      </div>
    </div>
  );
}
