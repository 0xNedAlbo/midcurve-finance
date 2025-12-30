"use client";

import { useEffect, useCallback } from "react";
import { Loader2, CheckCircle, XCircle, Wallet } from "lucide-react";
import type { DeployStrategyResponse, DeploymentStatus } from "@midcurve/api-shared";

// Statuses that indicate deployment is still in progress
const IN_PROGRESS_STATUSES: DeploymentStatus[] = [
  "pending",
  "signing",
  "broadcasting",
  "confirming",
  "setting_up_topology",
];

interface AutoWalletStepProps {
  /** Deployment result from the API */
  deploymentResult: DeployStrategyResponse | null;
  /** Error from the initial deployment mutation */
  deploymentError: string | null;
  /** Whether the deployment mutation is pending */
  isDeploying: boolean;
  /** Callback to initiate deployment */
  onDeploy: () => void;
  /** Callback to retry after error */
  onRetry: () => void;
  /** Callback when deployment result is updated from polling */
  onDeploymentStatusChange: (result: DeployStrategyResponse) => void;
  /** Callback when automation wallet is ready (auto-advance to next step) */
  onWalletReady: () => void;
}

export function AutoWalletStep({
  deploymentResult,
  deploymentError,
  isDeploying,
  onDeploy,
  onRetry,
  onDeploymentStatusChange,
  onWalletReady,
}: AutoWalletStepProps) {
  // Start deployment on mount if not already started
  useEffect(() => {
    if (!deploymentResult && !isDeploying && !deploymentError) {
      onDeploy();
    }
  }, [deploymentResult, isDeploying, deploymentError, onDeploy]);

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

  // Auto-advance when wallet is ready
  useEffect(() => {
    if (deploymentResult?.automationWallet?.address) {
      // Small delay to show the success state before advancing
      const timer = setTimeout(() => {
        onWalletReady();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [deploymentResult?.automationWallet?.address, onWalletReady]);

  // Error state
  const errorMessage =
    deploymentError ||
    (deploymentResult?.deployment.status === "failed"
      ? deploymentResult.deployment.error || "Deployment failed"
      : null);

  if (errorMessage) {
    return (
      <div className="space-y-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Failed to Create Automation Wallet
          </h3>
          <p className="text-slate-300 mb-4">{errorMessage}</p>
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
  if (deploymentResult?.automationWallet?.address) {
    return (
      <div className="space-y-6">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Automation Wallet Created
          </h3>
          <p className="text-slate-300">
            Your automation wallet is ready. Advancing to strategy deployment...
          </p>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
          <label className="block text-xs text-slate-400 mb-1">
            Automation Wallet Address
          </label>
          <code className="block text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
            {deploymentResult.automationWallet.address}
          </code>
          <p className="text-xs text-slate-500 mt-2">
            This wallet will execute automated transactions on behalf of your strategy.
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  return (
    <div className="space-y-6">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-6 text-center">
        <div className="relative w-16 h-16 mx-auto mb-4">
          <Wallet className="w-16 h-16 text-blue-400/30" />
          <Loader2 className="w-8 h-8 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">
          Creating Automation Wallet
        </h3>
        <p className="text-slate-300">
          Generating a secure wallet for your strategy...
        </p>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
        <p className="text-slate-400 text-sm">
          This wallet will be used to execute automated transactions on behalf of your
          strategy. It has no initial funds and will be funded through your vault.
        </p>
      </div>
    </div>
  );
}
