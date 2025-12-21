/**
 * StrategyEmptyState - Empty state when user has no strategies
 *
 * Shows option to deploy a new strategy.
 */

import { useState } from "react";
import { Rocket } from "lucide-react";
import { StrategyDeployWizard } from "./wizard/strategy-deploy-wizard";

interface StrategyEmptyStateProps {
  onDeploySuccess?: () => void;
}

export function StrategyEmptyState({ onDeploySuccess }: StrategyEmptyStateProps) {
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  return (
    <div className="text-center py-12 px-4">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
        <Rocket className="w-8 h-8 text-slate-400" />
      </div>

      <h3 className="text-xl font-semibold text-white mb-2">
        No Strategies Yet
      </h3>

      <p className="text-slate-400 mb-6 max-w-md mx-auto">
        Deploy an automated liquidity management strategy to get started.
        Strategies can manage multiple positions across different protocols.
      </p>

      <button
        onClick={() => setIsWizardOpen(true)}
        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
      >
        Deploy Strategy
      </button>

      <StrategyDeployWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onStrategyDeployed={() => {
          setIsWizardOpen(false);
          onDeploySuccess?.();
        }}
      />
    </div>
  );
}
