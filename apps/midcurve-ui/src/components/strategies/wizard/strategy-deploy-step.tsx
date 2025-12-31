"use client";

import { useEffect, useCallback } from "react";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Pen,
  Radio,
  Settings,
  FileCode,
} from "lucide-react";
import type { DeployStrategyResponse, DeploymentStatus } from "@midcurve/api-shared";

// Status display configuration
const DEPLOYMENT_STATUS_INFO: Record<
  DeploymentStatus,
  { label: string; description: string }
> = {
  pending: {
    label: "Preparing",
    description: "Initializing deployment...",
  },
  signing: {
    label: "Signing",
    description: "Signing the deployment transaction...",
  },
  broadcasting: {
    label: "Broadcasting",
    description: "Sending transaction to the network...",
  },
  confirming: {
    label: "Confirming",
    description: "Waiting for transaction confirmation...",
  },
  setting_up_topology: {
    label: "Setting Up",
    description: "Configuring strategy automation...",
  },
  completed: {
    label: "Complete",
    description: "Strategy deployed successfully!",
  },
  failed: {
    label: "Failed",
    description: "Deployment failed",
  },
};

// Statuses that indicate deployment is still in progress
const IN_PROGRESS_STATUSES: DeploymentStatus[] = [
  "pending",
  "signing",
  "broadcasting",
  "confirming",
  "setting_up_topology",
];

// Status order for progress display
const STATUS_ORDER: DeploymentStatus[] = [
  "pending",
  "signing",
  "broadcasting",
  "confirming",
  "setting_up_topology",
  "completed",
];

interface StrategyDeployStepProps {
  /** Deployment result from the API */
  deploymentResult: DeployStrategyResponse | null;
  /** Callback when deployment result is updated from polling */
  onDeploymentStatusChange: (result: DeployStrategyResponse) => void;
  /** Callback when strategy is fully deployed (auto-advance to next step) */
  onStrategyDeployed: () => void;
  /** Callback to retry after error */
  onRetry: () => void;
}

export function StrategyDeployStep({
  deploymentResult,
  onDeploymentStatusChange,
  onStrategyDeployed,
  onRetry,
}: StrategyDeployStepProps) {
  // Poll for deployment status
  const pollDeploymentStatus = useCallback(async () => {
    if (!deploymentResult?.deployment.pollUrl) return;

    const status = deploymentResult.deployment.status;
    if (!IN_PROGRESS_STATUSES.includes(status)) return;

    try {
      const response = await fetch(deploymentResult.deployment.pollUrl);

      if (!response.ok) {
        console.error("Poll failed:", response.status);
        return;
      }

      const apiResponse = await response.json();

      if (!apiResponse.success || !apiResponse.data) {
        console.error("Invalid poll response:", apiResponse);
        return;
      }

      const statusData = apiResponse.data;

      // Update deployment result with new status
      const updatedResult: DeployStrategyResponse = {
        ...deploymentResult,
        automationWallet: statusData.automationWallet || deploymentResult.automationWallet,
        strategy: statusData.strategy || deploymentResult.strategy,
        deployment: {
          ...deploymentResult.deployment,
          status: statusData.status,
          transactionHash: statusData.txHash || deploymentResult.deployment.transactionHash,
          contractAddress: statusData.contractAddress || deploymentResult.deployment.contractAddress,
          error: statusData.error,
        },
      };

      onDeploymentStatusChange(updatedResult);
    } catch (error) {
      console.error("Failed to poll deployment status:", error);
    }
  }, [deploymentResult, onDeploymentStatusChange]);

  // Set up polling interval
  useEffect(() => {
    if (!deploymentResult?.deployment.pollUrl) return;

    const status = deploymentResult.deployment.status;
    if (!IN_PROGRESS_STATUSES.includes(status)) return;

    // Poll every 2 seconds
    const interval = setInterval(pollDeploymentStatus, 2000);
    return () => clearInterval(interval);
  }, [deploymentResult, pollDeploymentStatus]);

  // Auto-advance when deployment is complete
  useEffect(() => {
    if (deploymentResult?.deployment.status === "completed") {
      // Small delay to show the success state before advancing
      const timer = setTimeout(() => {
        onStrategyDeployed();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [deploymentResult?.deployment.status, onStrategyDeployed]);

  // Error state
  if (deploymentResult?.deployment.status === "failed") {
    return (
      <div className="space-y-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Strategy Deployment Failed
          </h3>
          <p className="text-slate-300 mb-4">
            {deploymentResult.deployment.error || "Deployment failed"}
          </p>
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

  // Success state (briefly shown before auto-advancing)
  if (deploymentResult?.deployment.status === "completed") {
    return (
      <div className="space-y-6">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Strategy Deployed Successfully
          </h3>
          <p className="text-slate-300">
            Your strategy contract is live. Advancing to vault deployment...
          </p>
        </div>

        {deploymentResult.deployment.contractAddress && (
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
            <label className="block text-xs text-slate-400 mb-1">
              Contract Address
            </label>
            <code className="block text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
              {deploymentResult.deployment.contractAddress}
            </code>
          </div>
        )}
      </div>
    );
  }

  // Progress state
  const currentStatus = deploymentResult?.deployment.status || "pending";
  const statusInfo = DEPLOYMENT_STATUS_INFO[currentStatus];
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);
  const progressPercent = ((currentIndex + 1) / STATUS_ORDER.length) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-6 text-center">
        <div className="relative w-16 h-16 mx-auto mb-4">
          <FileCode className="w-16 h-16 text-blue-400/30" />
          <Loader2 className="w-8 h-8 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">
          Deploying Strategy Contract
        </h3>
        <p className="text-slate-300">{statusInfo.description}</p>
      </div>

      {/* Progress */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-slate-300 mb-3">
          Deployment Progress
        </h4>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Status Steps */}
        <div className="space-y-2">
          {STATUS_ORDER.slice(0, -1).map((status, index) => {
            const info = DEPLOYMENT_STATUS_INFO[status];
            const isComplete = currentIndex > index;
            const isCurrent = currentIndex === index;

            return (
              <div
                key={status}
                className={`flex items-center gap-3 text-sm ${
                  isComplete
                    ? "text-green-400"
                    : isCurrent
                      ? "text-blue-400"
                      : "text-slate-500"
                }`}
              >
                <div className="w-5 h-5 flex items-center justify-center">
                  {isComplete ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <div className="w-2 h-2 bg-slate-600 rounded-full" />
                  )}
                </div>
                <span>{info.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Transaction Info */}
      {deploymentResult?.deployment.transactionHash && (
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
          <label className="block text-xs text-slate-400 mb-1">
            Transaction Hash
          </label>
          <code className="block text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
            {deploymentResult.deployment.transactionHash}
          </code>
        </div>
      )}

      {/* Info */}
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
        <p className="text-slate-400 text-sm">
          Your strategy contract is being deployed to the internal SEMSEE network.
          This process is fully automated and usually takes less than a minute.
        </p>
      </div>
    </div>
  );
}
