"use client";

import type { PnLScenario } from "@midcurve/shared";

interface PnLScenarioTabsProps {
  scenario: PnLScenario;
  onScenarioChange: (scenario: PnLScenario) => void;
  hasStopLoss: boolean;
  hasTakeProfit: boolean;
}

const TABS: { id: PnLScenario; label: string; requires?: "sl" | "tp" }[] = [
  { id: "combined", label: "Configuration" },
  { id: "sl_triggered", label: "SL Triggered", requires: "sl" },
  { id: "tp_triggered", label: "TP Triggered", requires: "tp" },
];

export function PnLScenarioTabs({
  scenario,
  onScenarioChange,
  hasStopLoss,
  hasTakeProfit,
}: PnLScenarioTabsProps) {
  // Don't render tabs when neither SL nor TP is configured
  if (!hasStopLoss && !hasTakeProfit) return null;

  const visibleTabs = TABS.filter((tab) => {
    if (tab.requires === "sl") return hasStopLoss;
    if (tab.requires === "tp") return hasTakeProfit;
    return true;
  });

  return (
    <div className="flex gap-1.5 mb-2 shrink-0">
      {visibleTabs.map((tab) => {
        const isActive = scenario === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onScenarioChange(tab.id)}
            className={`px-3 py-1 text-xs font-medium border rounded-lg transition-colors cursor-pointer ${
              isActive
                ? "text-blue-400 bg-blue-900/20 border-blue-600/50"
                : "text-slate-400 bg-slate-800/30 hover:bg-slate-700/30 border-slate-600/30"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
