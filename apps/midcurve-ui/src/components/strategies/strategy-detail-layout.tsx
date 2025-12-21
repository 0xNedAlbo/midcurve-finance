/**
 * Strategy Detail Layout
 *
 * Main layout component for strategy detail pages.
 * Renders the header, tabs, and tab content.
 */

import { useSearchParams } from "react-router-dom";
import { StrategyDetailHeader } from "./strategy-detail-header";
import { StrategyDetailTabs } from "./strategy-detail-tabs";
import { StrategyFundingTab } from "./tabs/strategy-funding-tab";
import { StrategyLogsTab } from "./tabs/strategy-logs-tab";
import type { ListStrategyData } from "@midcurve/api-shared";

interface StrategyDetailLayoutProps {
  strategy: ListStrategyData;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

export function StrategyDetailLayout({
  strategy,
  onRefresh,
  isRefreshing,
}: StrategyDetailLayoutProps) {
  const [searchParams] = useSearchParams();

  // Get active tab from URL, default to "funding"
  const activeTab = searchParams.get("tab") || "funding";

  // Base path for tab navigation
  const basePath = `/strategies/${strategy.id}`;

  // Render tab content based on active tab
  const renderTabContent = () => {
    switch (activeTab) {
      case "logs":
        return <StrategyLogsTab />;
      case "funding":
      default:
        return <StrategyFundingTab />;
    }
  };

  return (
    <div>
      {/* Header with summary */}
      <StrategyDetailHeader
        strategy={strategy}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
      />

      {/* Tabs */}
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50">
        <div className="px-8 pt-4">
          <StrategyDetailTabs activeTab={activeTab} basePath={basePath} />
        </div>

        {/* Tab Content */}
        <div className="px-8 pb-6">{renderTabContent()}</div>
      </div>
    </div>
  );
}
