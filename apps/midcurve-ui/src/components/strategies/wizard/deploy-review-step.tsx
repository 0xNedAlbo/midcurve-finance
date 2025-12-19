import { useNavigate } from "react-router-dom";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Rocket,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";
import type { StrategyManifest, ConstructorParam } from "@midcurve/shared";
import type { DeployStrategyResponse } from "@midcurve/api-shared";

interface DeployReviewStepProps {
  manifest: StrategyManifest;
  strategyName: string;
  constructorValues: Record<string, string>;
  deploymentResult: DeployStrategyResponse | null;
  deploymentError: string | null;
  isDeploying: boolean;
  onDeploy: () => void;
  onRetry: () => void;
}

export function DeployReviewStep({
  manifest,
  strategyName,
  constructorValues,
  deploymentResult,
  deploymentError,
  isDeploying,
  onDeploy,
  onRetry,
}: DeployReviewStepProps) {
  const navigate = useNavigate();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Get display value for a constructor parameter based on its source
  const getParamDisplayValue = (param: ConstructorParam): string => {
    switch (param.source) {
      case "operator-address":
        return "Auto-generated wallet";
      case "core-address":
        return "System address";
      case "user-input":
        return constructorValues[param.name] || "-";
      default:
        return "-";
    }
  };

  const copyToClipboard = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Success state
  if (deploymentResult && deploymentResult.deployment.status === "confirmed") {
    return (
      <div className="space-y-6">
        {/* Success Banner */}
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Strategy Deployed Successfully!
          </h3>
          <p className="text-slate-300">
            Your strategy "{strategyName}" is now active and ready to use.
          </p>
        </div>

        {/* Deployment Details */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg divide-y divide-slate-700/50">
          {/* Contract Address */}
          {deploymentResult.deployment.contractAddress && (
            <div className="p-4">
              <label className="block text-xs text-slate-400 mb-1">
                Contract Address
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
                  {deploymentResult.deployment.contractAddress}
                </code>
                <button
                  onClick={() =>
                    copyToClipboard(
                      deploymentResult.deployment.contractAddress!,
                      "contract"
                    )
                  }
                  className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Copy to clipboard"
                >
                  {copiedField === "contract" ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Automation Wallet */}
          <div className="p-4">
            <label className="block text-xs text-slate-400 mb-1">
              Automation Wallet
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
                {deploymentResult.automationWallet.address}
              </code>
              <button
                onClick={() =>
                  copyToClipboard(
                    deploymentResult.automationWallet.address,
                    "wallet"
                  )
                }
                className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Copy to clipboard"
              >
                {copiedField === "wallet" ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              This wallet will execute automated transactions on behalf of your strategy.
            </p>
          </div>

          {/* Transaction Hash */}
          {deploymentResult.deployment.transactionHash && (
            <div className="p-4">
              <label className="block text-xs text-slate-400 mb-1">
                Transaction Hash
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
                  {deploymentResult.deployment.transactionHash}
                </code>
                <button
                  onClick={() =>
                    copyToClipboard(
                      deploymentResult.deployment.transactionHash!,
                      "txHash"
                    )
                  }
                  className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Copy to clipboard"
                >
                  {copiedField === "txHash" ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Button */}
        <div className="flex justify-center">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
          >
            View Dashboard
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (deploymentError) {
    return (
      <div className="space-y-6">
        {/* Error Banner */}
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Deployment Failed
          </h3>
          <p className="text-slate-300 mb-4">{deploymentError}</p>
          <button
            onClick={onRetry}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Deploying state
  if (isDeploying) {
    return (
      <div className="space-y-6">
        {/* Deploying Banner */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-6 text-center">
          <Loader2 className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-spin" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Deploying Strategy...
          </h3>
          <p className="text-slate-300">
            Creating your automation wallet and deploying the contract.
            This may take a moment.
          </p>
        </div>

        {/* Summary */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-slate-300 mb-3">Deployment Summary</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Strategy Template</span>
              <span className="text-white">{manifest.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Strategy Name</span>
              <span className="text-white">{strategyName}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Pre-deploy review state
  return (
    <div className="space-y-6">
      <p className="text-slate-300">
        Review your strategy configuration before deployment. Once deployed, the
        contract cannot be modified.
      </p>

      {/* Summary */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg divide-y divide-slate-700/50">
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Strategy Template</span>
            <span className="text-white font-medium">{manifest.name}</span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Version</span>
            <span className="text-white">v{manifest.version}</span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Strategy Name</span>
            <span className="text-white font-medium">{strategyName}</span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Network</span>
            <span className="text-white">SEMSEE (Internal)</span>
          </div>
        </div>

        {/* Constructor Parameters (all params including auto-populated) */}
        {manifest.constructorParams.length > 0 && (
          <div className="p-4">
            <p className="text-slate-400 text-sm mb-3">Constructor Parameters</p>
            <div className="space-y-2">
              {manifest.constructorParams.map((param) => (
                <div
                  key={param.name}
                  className="flex justify-between items-center text-sm"
                >
                  <span className="text-slate-400">
                    {param.ui?.label ?? param.name}
                  </span>
                  <span className="text-white font-mono">
                    {getParamDisplayValue(param)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Deploy Button */}
      <div className="flex justify-center">
        <button
          onClick={onDeploy}
          className="flex items-center gap-2 px-8 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
        >
          <Rocket className="w-5 h-5" />
          Deploy Strategy
        </button>
      </div>
    </div>
  );
}
