"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { StrategyDeployWizard } from "./wizard/strategy-deploy-wizard";

export function CreateStrategyDropdown() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const handleOpenWizard = () => {
    setIsWizardOpen(true);
  };

  return (
    <>
      {/* Button - Simple single action, no dropdown needed for now */}
      <button
        onClick={handleOpenWizard}
        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
      >
        <Zap className="w-5 h-5" />
        Deploy Strategy
      </button>

      {/* Wizard Modal */}
      <StrategyDeployWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onStrategyDeployed={(response) => {
          // Strategy deployed - wizard handles navigation to dashboard
          console.log("Strategy deployed:", response.strategy.id);
        }}
      />
    </>
  );
}
