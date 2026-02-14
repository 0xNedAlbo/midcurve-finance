import { useSearchParams } from "react-router-dom";
import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import { useUniswapV3LiveMetrics } from "@/hooks/positions/uniswapv3/useUniswapV3LiveMetrics";
import { useUniswapV3AutoRefresh } from "@/hooks/positions/uniswapv3/useUniswapV3AutoRefresh";
import { useUniswapV3RefreshPosition } from "@/hooks/positions/uniswapv3/useUniswapV3RefreshPosition";
import { PositionDetailHeader } from "../../position-detail-header";
import { PositionDetailTabs } from "../../position-detail-tabs";
import { UniswapV3OverviewTab } from "./uniswapv3-overview-tab";
import { UniswapV3AprTab } from "./uniswapv3-apr-tab";
import { UniswapV3HistoryTab } from "./uniswapv3-history-tab";
import { UniswapV3AutomationTab } from "./uniswapv3-automation-tab";
import { UniswapV3TechnicalTab } from "./uniswapv3-technical-tab";
import { getChainMetadataByChainId } from "@/config/chains";
import { getNonfungiblePositionManagerAddress } from "@/config/contracts/nonfungible-position-manager";

interface UniswapV3PositionDetailProps {
  position: UniswapV3PositionData;
}

export type TabType = "overview" | "apr-analysis" | "pnl-analysis" | "automation" | "technical";

export function UniswapV3PositionDetail({ position: rawPosition }: UniswapV3PositionDetailProps) {
  const [searchParams] = useSearchParams();

  // Get tab from URL query params, default to 'overview'
  // Read directly from URL params (no state) so it updates when URL changes
  const activeTab = (searchParams.get("tab") || "overview") as TabType;

  // Extract chain ID and NFT ID for header
  const config = rawPosition.config as { chainId: number; nftId: number; tickLower: number; tickUpper: number };

  // Patch live pool price into position data (5s polling)
  const position = useUniswapV3LiveMetrics(rawPosition);

  // On-chain refresh on mount + every 60s (fire-and-forget, DB polling picks up changes)
  const { isRefreshing: isAutoRefreshing } = useUniswapV3AutoRefresh(config.chainId, String(config.nftId));

  // Manual refresh via POST endpoint (on-chain sync, not just DB refetch)
  const refreshMutation = useUniswapV3RefreshPosition();
  const isRefreshing = isAutoRefreshing || refreshMutation.isPending;

  const handleRefresh = async () => {
    refreshMutation.mutate({
      chainId: config.chainId,
      nftId: String(config.nftId),
    });
  };

  const poolState = position.pool.state as { currentTick: number };
  const positionState = position.state as { liquidity: string };
  const chainMetadata = getChainMetadataByChainId(config.chainId);
  const chainSlug = chainMetadata?.slug || 'ethereum';

  // Compute derived fields
  const isInRange = poolState.currentTick >= config.tickLower && poolState.currentTick <= config.tickUpper;
  const status = BigInt(positionState.liquidity) > 0n ? "active" : "closed";

  // Get NFPM address for explorer link
  const nftManagerAddress = getNonfungiblePositionManagerAddress(config.chainId);

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
        isRefreshing={isRefreshing}
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
        {activeTab === "automation" && <UniswapV3AutomationTab position={position} />}
        {activeTab === "technical" && <UniswapV3TechnicalTab position={position} />}
      </div>
    </div>
  );
}
