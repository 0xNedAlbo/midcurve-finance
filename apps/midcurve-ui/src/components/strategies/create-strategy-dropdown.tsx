"use client";

// TODO: Re-enable Deploy Strategy button when strategy feature is ready
// import { useState } from "react";
// import { Zap } from "lucide-react";
// import { StrategyDeployWizard } from "./wizard/strategy-deploy-wizard";

export function CreateStrategyDropdown() {
  // TODO: Re-enable Deploy Strategy button when strategy feature is ready
  return null;

  /* TODO: Re-enable Deploy Strategy button when strategy feature is ready
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const handleOpenWizard = () => {
    setIsWizardOpen(true);
  };

  return (
    <>
      <button
        onClick={handleOpenWizard}
        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
      >
        <Zap className="w-5 h-5" />
        Deploy Strategy
      </button>

      <StrategyDeployWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onStrategyDeployed={(response) => {
          console.log("Strategy deployed:", response.deployment.contractAddress);
        }}
      />
    </>
  );
  */
}
