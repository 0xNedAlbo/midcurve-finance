"use client";

import { useSearchParams } from "next/navigation";
import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import { PositionDetailHeader } from "../../position-detail-header";
import { PositionDetailTabs } from "../../position-detail-tabs";
import { UniswapV3OverviewTab } from "./uniswapv3-overview-tab";
import { UniswapV3AprTab } from "./uniswapv3-apr-tab";
import { UniswapV3HistoryTab } from "./uniswapv3-history-tab";
import { UniswapV3TechnicalTab } from "./uniswapv3-technical-tab";
import { getChainMetadataByChainId } from "@/config/chains";
import { getNonfungiblePositionManagerAddress } from "@/config/contracts/nonfungible-position-manager";

interface UniswapV3PositionDetailProps {
  position: GetUniswapV3PositionResponse;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export type TabType = "overview" | "apr-analysis" | "pnl-analysis" | "technical";

export function UniswapV3PositionDetail({ position, onRefresh, isRefreshing }: UniswapV3PositionDetailProps) {
  const searchParams = useSearchParams();

  // Get tab from URL query params, default to 'overview'
  // Read directly from URL params (no state) so it updates when URL changes
  const activeTab = (searchParams.get("tab") || "overview") as TabType;

  // Extract chain ID and NFT ID for header
  const config = position.config as { chainId: number; nftId: number; tickLower: number; tickUpper: number };
  const poolState = position.pool.state as { currentTick: number };
  const positionState = position.state as { liquidity: string };
  const chainMetadata = getChainMetadataByChainId(config.chainId);
  const chainSlug = chainMetadata?.slug || 'ethereum';

  // Compute derived fields
  const isInRange = poolState.currentTick >= config.tickLower && poolState.currentTick <= config.tickUpper;
  const status = BigInt(positionState.liquidity) > 0n ? "active" : "closed";

  // Get NFPM address for explorer link
  const nftManagerAddress = getNonfungiblePositionManagerAddress(config.chainId);

  // Wrap onRefresh to ensure it returns Promise<void>
  const handleRefresh = async () => {
    if (onRefresh) {
      await onRefresh();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PositionDetailHeader
        token0Symbol={position.pool.token0.symbol}
        token1Symbol={position.pool.token1.symbol}
        token0LogoUrl={position.pool.token0.logoUrl || undefined}
        token1LogoUrl={position.pool.token1.logoUrl || undefined}
        status={status}
        isInRange={isInRange}
        chainMetadata={{
          shortName: chainMetadata?.shortName || "Unknown",
          explorer: chainMetadata?.explorer || "",
        }}
        protocol={position.protocol}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing || false}
        feeTierDisplay={<span>{(position.pool.feeBps / 10000).toFixed(2)}%</span>}
        identifierDisplay={<span>#{config.nftId}</span>}
        explorerUrl={nftManagerAddress ? `${chainMetadata?.explorer}/token/${nftManagerAddress}?a=${config.nftId}` : undefined}
        explorerLabel="NFT"
        updatedAt={position.updatedAt}
      />

      {/* Tabs Navigation */}
      <PositionDetailTabs
        activeTab={activeTab}
        basePath={`/positions/uniswapv3/${chainSlug}/${config.nftId}`}
      />

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === "overview" && <UniswapV3OverviewTab position={position} />}
        {activeTab === "apr-analysis" && <UniswapV3AprTab position={position} />}
        {activeTab === "pnl-analysis" && <UniswapV3HistoryTab position={position} />}
        {activeTab === "technical" && <UniswapV3TechnicalTab position={position} />}
      </div>
    </div>
  );
}
