import { useSearchParams, useNavigate } from "react-router-dom";
import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import { useUniswapV3VaultLiveMetrics } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultLiveMetrics";
import { useUniswapV3VaultAutoRefresh } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultAutoRefresh";
import { useUniswapV3VaultRefreshPosition } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultRefreshPosition";
import { PositionDetailHeader } from "../../position-detail-header";
import { UniswapV3VaultOverviewTab } from "./uniswapv3-vault-overview-tab";
import { UniswapV3VaultAprTab } from "./uniswapv3-vault-apr-tab";
import { UniswapV3VaultHistoryTab } from "./uniswapv3-vault-history-tab";
import { UniswapV3VaultTechnicalTab } from "./uniswapv3-vault-technical-tab";
import { UniswapV3VaultAutomationTab } from "./uniswapv3-vault-automation-tab";
import { getChainMetadataByChainId } from "@/config/chains";
import { BarChart3, Clock, TrendingUp, Settings, Shield } from "lucide-react";
import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
} from "@midcurve/api-shared";

interface UniswapV3VaultPositionDetailProps {
  position: UniswapV3VaultPositionData;
}

export type VaultTabType = "overview" | "apr-analysis" | "pnl-analysis" | "automation" | "technical";

const vaultTabs = [
  { id: "overview", icon: BarChart3, label: "Overview" },
  { id: "pnl-analysis", icon: Clock, label: "PnL Analysis" },
  { id: "apr-analysis", icon: TrendingUp, label: "APR Analysis" },
  { id: "automation", icon: Shield, label: "Automation" },
  { id: "technical", icon: Settings, label: "Technical Details" },
] as const;

export function UniswapV3VaultPositionDetail({ position: rawPosition }: UniswapV3VaultPositionDetailProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Get tab from URL query params, default to 'overview'
  const activeTab = (searchParams.get("tab") || "overview") as VaultTabType;

  // Extract chain ID and vault address for header
  const config = rawPosition.config as UniswapV3VaultPositionConfigResponse;
  const state = rawPosition.state as UniswapV3VaultPositionStateResponse;

  // Patch live pool price into position data (5s polling)
  const position = useUniswapV3VaultLiveMetrics(rawPosition);

  // On-chain refresh on mount + every 60s (fire-and-forget, DB polling picks up changes)
  const { isRefreshing: isAutoRefreshing } = useUniswapV3VaultAutoRefresh(config.chainId, config.vaultAddress);

  // Manual refresh via POST endpoint (on-chain sync, not just DB refetch)
  const refreshMutation = useUniswapV3VaultRefreshPosition();
  const isRefreshing = isAutoRefreshing || refreshMutation.isPending;

  const handleRefresh = async () => {
    refreshMutation.mutate({
      chainId: config.chainId,
      vaultAddress: config.vaultAddress,
    });
  };

  const poolState = position.pool.state as { currentTick: number };
  const chainMetadata = getChainMetadataByChainId(config.chainId);
  const chainSlug = chainMetadata?.slug || "ethereum";

  // Compute derived fields
  const isInRange = poolState.currentTick >= config.tickLower && poolState.currentTick <= config.tickUpper;
  const status = BigInt(state.sharesBalance) > 0n ? "active" : "closed";

  // Truncated vault address for identifier display (first 6 + last 4 chars)
  const truncatedAddress = `${config.vaultAddress.slice(0, 6)}...${config.vaultAddress.slice(-4)}`;

  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams);
    if (tabId === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", tabId);
    }
    const queryString = params.toString();
    const url = `/positions/uniswapv3-vault/${chainSlug}/${config.vaultAddress}${queryString ? `?${queryString}` : ""}`;
    navigate(url);
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
        isRefreshing={isRefreshing}
        extraStatusBadges={
          <>
            <span className="px-3 py-1 rounded-lg text-sm font-medium border text-slate-300 bg-slate-500/10 border-slate-500/20">
              Tokenized
            </span>
            <span className="px-3 py-1 rounded-lg text-sm font-medium border text-purple-400 bg-purple-500/10 border-purple-500/20">
              {BigInt(state.totalSupply) > 0n
                ? `${(Number(BigInt(state.sharesBalance) * 10000n / BigInt(state.totalSupply)) / 100).toFixed(2)}% Shares`
                : "0% Shares"}
            </span>
          </>
        }
        feeTierDisplay={<span>{(position.pool.feeBps / 10000).toFixed(2)}%</span>}
        identifierDisplay={<span>{truncatedAddress}</span>}
        explorerUrl={`${chainMetadata?.explorer}/address/${config.vaultAddress}`}
        explorerLabel="Vault"
        updatedAt={position.updatedAt}
      />

      {/* Tabs Navigation */}
      <div className="border-b border-slate-700/50">
        <nav className="flex space-x-8">
          {vaultTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`
                  relative flex items-center gap-2 py-4 px-1 text-sm font-medium transition-colors cursor-pointer
                  ${
                    isActive
                      ? "text-white border-b-2 border-blue-500"
                      : "text-slate-400 hover:text-slate-300"
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>

                {/* Active tab indicator */}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === "overview" && <UniswapV3VaultOverviewTab position={position} />}
        {activeTab === "apr-analysis" && <UniswapV3VaultAprTab position={position} />}
        {activeTab === "pnl-analysis" && <UniswapV3VaultHistoryTab position={position} />}
        {activeTab === "automation" && <UniswapV3VaultAutomationTab position={position} />}
        {activeTab === "technical" && <UniswapV3VaultTechnicalTab position={position} />}
      </div>
    </div>
  );
}
