/**
 * Strategy Detail Tabs
 *
 * Tab navigation for strategy detail pages.
 * Manages active tab state via URL query parameters.
 */

import { useNavigate, useSearchParams } from "react-router-dom";
import { Wallet, ScrollText } from "lucide-react";

interface StrategyDetailTabsProps {
  activeTab: string;
  basePath: string; // e.g., "/strategies/abc123"
}

const tabs = [
  {
    id: "funding",
    icon: Wallet,
    label: "Funding",
  },
  {
    id: "logs",
    icon: ScrollText,
    label: "Logs",
  },
];

export function StrategyDetailTabs({
  activeTab,
  basePath,
}: StrategyDetailTabsProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams);
    if (tabId === "funding") {
      params.delete("tab");
    } else {
      params.set("tab", tabId);
    }

    const queryString = params.toString();
    const url = `${basePath}${queryString ? `?${queryString}` : ""}`;
    navigate(url);
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
