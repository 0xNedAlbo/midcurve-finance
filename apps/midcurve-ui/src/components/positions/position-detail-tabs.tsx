/**
 * Position Detail Tabs - Protocol-Agnostic
 *
 * Tab navigation for position detail pages.
 * Manages active tab state via URL query parameters.
 */

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Clock, TrendingUp, Settings } from "lucide-react";

interface PositionDetailTabsProps {
  activeTab: string;
  basePath: string; // e.g., "/positions/uniswapv3/1/12345"
}

const tabs = [
  {
    id: "overview",
    icon: BarChart3,
    label: "Overview",
  },
  {
    id: "pnl-analysis",
    icon: Clock,
    label: "PnL Analysis",
  },
  {
    id: "apr-analysis",
    icon: TrendingUp,
    label: "APR Analysis",
  },
  {
    id: "technical",
    icon: Settings,
    label: "Technical Details",
  },
];

export function PositionDetailTabs({
  activeTab,
  basePath,
}: PositionDetailTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams);
    if (tabId === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", tabId);
    }

    const queryString = params.toString();
    const url = `${basePath}${queryString ? `?${queryString}` : ""}`;
    router.push(url);
  };

  return (
    <div className="border-b border-slate-700/50">
      <nav className="flex space-x-8">
        {tabs.map((tab) => {
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
  );
}
