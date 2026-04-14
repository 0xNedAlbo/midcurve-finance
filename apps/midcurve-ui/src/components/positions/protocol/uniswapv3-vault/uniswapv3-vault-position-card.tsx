/**
 * UniswapV3VaultPositionCard - Self-sufficient position card for vault positions
 *
 * This component is responsible for its own data lifecycle:
 * 1. Shows skeleton layout matching final dimensions
 * 2. Fetches detail data via useUniswapV3VaultPosition hook (3s DB polling)
 * 3. Triggers on-chain refresh via useUniswapV3VaultAutoRefresh (60s)
 * 4. Patches live pool price via useUniswapV3VaultLiveMetrics (5s)
 * 5. Renders header, metrics, PnL curve, and action buttons
 *
 * Props are just chainId + vaultAddress — all other data is fetched internally.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type {
  UniswapV3VaultPositionConfigResponse,
} from "@midcurve/api-shared";
import { PositionCardHeader } from "../../position-card-header";
import { PositionCardMetrics } from "../../position-card-metrics";
import { UniswapV3VaultIdentifier } from "./uniswapv3-vault-identifier";
import { UniswapV3VaultRangeStatus } from "./uniswapv3-vault-range-status";
import { UniswapV3VaultChainBadge } from "./uniswapv3-vault-chain-badge";
import { UniswapV3VaultShareOwnerBadge } from "./uniswapv3-vault-share-owner-badge";
import { UniswapV3VaultMiniPnLCurve } from "./uniswapv3-vault-mini-pnl-curve";
import { UniswapV3VaultActions } from "./uniswapv3-vault-actions";
import { PositionActionsMenu } from "../../position-actions-menu";
import { UniswapV3VaultDeletePositionModal } from "./uniswapv3-vault-delete-position-modal";
import { UniswapV3VaultReloadHistoryModal } from "./uniswapv3-vault-reload-history-modal";
import { UniswapV3VaultSwitchQuoteTokenModal } from "./uniswapv3-vault-switch-quote-token-modal";
import { useIsMutating } from "@tanstack/react-query";
import { deletePositionMutationKey } from "@/hooks/positions/useDeletePosition";
import { reloadPositionHistoryMutationKey } from "@/hooks/positions/useReloadPositionHistory";
import { switchQuoteTokenMutationKey } from "@/hooks/positions/useSwitchQuoteToken";

import { useUniswapV3VaultRefreshPosition } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultRefreshPosition";
import { useUniswapV3VaultAutoRefresh } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultAutoRefresh";
import { useUniswapV3VaultPosition } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import { useUniswapV3VaultLiveMetrics } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultLiveMetrics";
import { getChainSlugByChainId } from "@/config/chains";

interface UniswapV3VaultPositionCardProps {
  chainId: number;
  vaultAddress: string;
  ownerAddress: string;
  index?: number;
}

export function UniswapV3VaultPositionCard({ chainId, vaultAddress, ownerAddress, index = 0 }: UniswapV3VaultPositionCardProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReloadHistoryModal, setShowReloadHistoryModal] = useState(false);
  const [showSwitchQuoteTokenModal, setShowSwitchQuoteTokenModal] = useState(false);

  const isAlt = index % 2 === 1;

  // Fetch position detail (auto-refreshes every 3s)
  const { data: position, isLoading } = useUniswapV3VaultPosition(chainId, vaultAddress, ownerAddress);

  // Show skeleton while loading
  if (isLoading || !position) {
    return <UniswapV3VaultPositionCardSkeleton isAlt={isAlt} />;
  }

  return (
    <UniswapV3VaultPositionCardLoaded
      position={position}
      chainId={chainId}
      vaultAddress={vaultAddress}
      ownerAddress={ownerAddress}
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

interface UniswapV3VaultPositionCardLoadedProps {
  position: UniswapV3VaultPositionData;
  chainId: number;
  vaultAddress: string;
  ownerAddress: string;
  isAlt: boolean;
  showDeleteModal: boolean;
  setShowDeleteModal: (show: boolean) => void;
  showReloadHistoryModal: boolean;
  setShowReloadHistoryModal: (show: boolean) => void;
  showSwitchQuoteTokenModal: boolean;
  setShowSwitchQuoteTokenModal: (show: boolean) => void;
}

function UniswapV3VaultPositionCardLoaded({
  position: rawPosition,
  chainId,
  vaultAddress,
  ownerAddress,
  isAlt,
  showDeleteModal,
  setShowDeleteModal,
  showReloadHistoryModal,
  setShowReloadHistoryModal,
  showSwitchQuoteTokenModal,
  setShowSwitchQuoteTokenModal,
}: UniswapV3VaultPositionCardLoadedProps) {
  // Patch live pool price into position data (5s polling)
  const position = useUniswapV3VaultLiveMetrics(rawPosition);

  // On-chain refresh on mount + every 60s (fire-and-forget, DB polling picks up changes)
  const { isRefreshing: isAutoRefreshing } = useUniswapV3VaultAutoRefresh(chainId, vaultAddress, ownerAddress);

  const isDeleting = useIsMutating({ mutationKey: deletePositionMutationKey(position.positionHash) }) > 0;
  const isReloadingHistory = useIsMutating({ mutationKey: reloadPositionHistoryMutationKey(position.positionHash) }) > 0;
  const isSwitchingQuoteToken = useIsMutating({ mutationKey: switchQuoteTokenMutationKey(position.positionHash) }) > 0;
  const refreshMutation = useUniswapV3VaultRefreshPosition();
  const isRefreshing = isAutoRefreshing || refreshMutation.isPending;

  // Extract token roles
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;

  // Calculate in-range status
  const config = position.config as UniswapV3VaultPositionConfigResponse;
  const poolState = position.pool.state as { currentTick: number };
  const isInRange = position.isActive &&
    poolState.currentTick >= config.tickLower &&
    poolState.currentTick <= config.tickUpper;

  // Detail page path
  const chainSlug = getChainSlugByChainId(chainId);
  const detailPath = chainSlug
    ? `/positions/uniswapv3-vault/${chainSlug}/${vaultAddress}/${ownerAddress}`
    : `/positions/uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}`;

  const handleRefresh = () => {
    refreshMutation.mutate({
      chainId,
      vaultAddress,
      ownerAddress,
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
          statusLineBadges={
            <>
              <UniswapV3VaultRangeStatus position={position} />
              <span className="px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-xs font-medium border text-slate-300 bg-slate-500/10 border-slate-500/20">
                Tokenized
              </span>
            </>
          }
          protocolLineBadges={
            <>
              <UniswapV3VaultChainBadge position={position} />
              <UniswapV3VaultIdentifier position={position} />
              <UniswapV3VaultShareOwnerBadge position={position} />
            </>
          }
        />

        {/* MIDDLE: Metrics */}
        <PositionCardMetrics
          currentValue={position.currentValue}
          realizedPnl={position.realizedPnl}
          unrealizedPnl={position.unrealizedPnl}
          unclaimedYield={position.unclaimedYield}
          costBasis={position.costBasis}
          lastYieldClaimedAt={position.lastYieldClaimedAt}
          positionOpenedAt={position.positionOpenedAt}
          quoteToken={quoteToken}
          isActive={position.isActive}
          isInRange={isInRange}
          totalApr={position.totalApr}
          pnlCurveSlot={<UniswapV3VaultMiniPnLCurve position={position} />}
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
      <UniswapV3VaultActions position={position} isInRange={isInRange} />

      {/* Reload History Modal */}
      <UniswapV3VaultReloadHistoryModal
        isOpen={showReloadHistoryModal}
        onClose={() => setShowReloadHistoryModal(false)}
        onReloadSuccess={() => {}}
        positionHash={position.positionHash}
        chainId={chainId}
        vaultAddress={vaultAddress}
        ownerAddress={ownerAddress}
        token0Symbol={position.pool.token0.symbol}
        token1Symbol={position.pool.token1.symbol}
        feeBps={position.pool.feeBps}
      />

      {/* Switch Quote Token Modal */}
      <UniswapV3VaultSwitchQuoteTokenModal
        isOpen={showSwitchQuoteTokenModal}
        onClose={() => setShowSwitchQuoteTokenModal(false)}
        onSwitchSuccess={() => {}}
        positionHash={position.positionHash}
        chainId={chainId}
        vaultAddress={vaultAddress}
        ownerAddress={ownerAddress}
        token0Symbol={position.pool.token0.symbol}
        token1Symbol={position.pool.token1.symbol}
        feeBps={position.pool.feeBps}
        isToken0Quote={position.isToken0Quote}
      />

      {/* Delete Position Modal */}
      <UniswapV3VaultDeletePositionModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onDeleteSuccess={() => {}}
        positionHash={position.positionHash}
        chainId={chainId}
        vaultAddress={vaultAddress}
        ownerAddress={ownerAddress}
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

function UniswapV3VaultPositionCardSkeleton({ isAlt = false }: { isAlt?: boolean }) {
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
    </div>
  );
}
