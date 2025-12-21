import { useNavigate } from "react-router-dom";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Rocket,
  ExternalLink,
  Copy,
  Check,
  Pen,
  Radio,
  Clock,
  Settings,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import type { StrategyManifest, ConstructorParam } from "@midcurve/shared";
import type { DeployStrategyResponse, DeploymentStatus } from "@midcurve/api-shared";

// Status display configuration
const DEPLOYMENT_STATUS_INFO: Record<
  DeploymentStatus,
  { label: string; description: string; icon: React.ReactNode }
> = {
  pending: {
    label: "Preparing",
    description: "Initializing deployment...",
    icon: <Clock className="w-5 h-5" />,
  },
  signing: {
    label: "Signing",
    description: "Signing the deployment transaction...",
    icon: <Pen className="w-5 h-5" />,
  },
  broadcasting: {
    label: "Broadcasting",
    description: "Sending transaction to the network...",
    icon: <Radio className="w-5 h-5" />,
  },
  confirming: {
    label: "Confirming",
    description: "Waiting for transaction confirmation...",
    icon: <Clock className="w-5 h-5" />,
  },
  setting_up_topology: {
    label: "Setting Up",
    description: "Configuring strategy automation...",
    icon: <Settings className="w-5 h-5" />,
  },
  completed: {
    label: "Complete",
    description: "Strategy deployed successfully!",
    icon: <CheckCircle className="w-5 h-5" />,
  },
  failed: {
    label: "Failed",
    description: "Deployment failed",
    icon: <XCircle className="w-5 h-5" />,
  },
};

// Statuses that indicate deployment is in progress
const IN_PROGRESS_STATUSES: DeploymentStatus[] = [
  "pending",
  "signing",
  "broadcasting",
  "confirming",
  "setting_up_topology",
];

interface DeployReviewStepProps {
  manifest: StrategyManifest;
  strategyName: string;
  constructorValues: Record<string, string>;
  deploymentResult: DeployStrategyResponse | null;
  deploymentError: string | null;
  isDeploying: boolean;
  onDeploy: () => void;
  onRetry: () => void;
  onDeploymentStatusChange?: (result: DeployStrategyResponse) => void;
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
  onDeploymentStatusChange,
}: DeployReviewStepProps) {
  const navigate = useNavigate();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);

  // Poll for deployment status updates
  // REST Standard: GET always returns 200 if resource exists, status is in body
  const pollDeploymentStatus = useCallback(async () => {
    if (!deploymentResult?.deployment.pollUrl) return;

    const status = deploymentResult.deployment.status;
    if (!IN_PROGRESS_STATUSES.includes(status)) return;

    try {
      const response = await fetch(deploymentResult.deployment.pollUrl);

      // 404 = deployment not found (shouldn't happen if we just started it)
      if (response.status === 404) {
        throw new Error("Deployment not found");
      }

      // 5xx = actual server error (bug), not deployment failure
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || errorData.error || `Status check failed: ${response.status}`;
        throw new Error(errorMessage);
      }

      const apiResponse = await response.json();

      // API returns { success: true, data: { status, contractAddress, txHash, error, ... } }
      if (!apiResponse.success || !apiResponse.data) {
        throw new Error(apiResponse.error?.message || "Invalid API response");
      }

      const statusData = apiResponse.data;

      // Update deployment result with new status
      // REST standard: status is always in body, even for "failed" (which returns 200)
      const updatedResult: DeployStrategyResponse = {
        ...deploymentResult,
        deployment: {
          ...deploymentResult.deployment,
          status: statusData.status,
          transactionHash: statusData.txHash || deploymentResult.deployment.transactionHash,
          contractAddress: statusData.contractAddress || deploymentResult.deployment.contractAddress,
          error: statusData.error,
        },
      };

      onDeploymentStatusChange?.(updatedResult);
      setPollingError(null);
    } catch (error) {
      console.error("Failed to poll deployment status:", error);
      setPollingError(error instanceof Error ? error.message : "Failed to check status");
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
  if (deploymentResult && deploymentResult.deployment.status === "completed") {
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

          {/* Automation Wallet (only shown if available) */}
          {deploymentResult.automationWallet?.address && (
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
                      deploymentResult.automationWallet!.address,
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
          )}

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

  // Error state (either from API error or async deployment failure)
  const errorMessage =
    deploymentError ||
    (deploymentResult?.deployment.status === "failed"
      ? deploymentResult.deployment.error || "Deployment failed"
      : null);

  if (errorMessage) {
    return (
      <div className="space-y-6">
        {/* Error Banner */}
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Deployment Failed
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

  // Deploying state - either initial API call or async polling
  const isDeployingAsync =
    deploymentResult && IN_PROGRESS_STATUSES.includes(deploymentResult.deployment.status);

  if (isDeploying || isDeployingAsync) {
    const currentStatus = deploymentResult?.deployment.status || "pending";
    const statusInfo = DEPLOYMENT_STATUS_INFO[currentStatus];

    // Calculate progress based on status
    const statusOrder: DeploymentStatus[] = [
      "pending",
      "signing",
      "broadcasting",
      "confirming",
      "setting_up_topology",
      "completed",
    ];
    const currentIndex = statusOrder.indexOf(currentStatus);
    const progressPercent = ((currentIndex + 1) / statusOrder.length) * 100;

    return (
      <div className="space-y-6">
        {/* Deploying Banner */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-6 text-center">
          <Loader2 className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-spin" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Deploying Strategy...
          </h3>
          <p className="text-slate-300">
            {statusInfo.description}
          </p>
        </div>

        {/* Deployment Progress */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-slate-300 mb-3">Deployment Progress</h4>

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
            {statusOrder.slice(0, -1).map((status, index) => {
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

          {/* Polling error notice */}
          {pollingError && (
            <div className="mt-3 text-xs text-yellow-400">
              Status check failed: {pollingError}. Retrying...
            </div>
          )}
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
            <div className="flex justify-between">
              <span className="text-slate-400">Quote Currency</span>
              <span className="text-white">
                {manifest.quoteToken.type === "basic-currency"
                  ? manifest.quoteToken.symbol
                  : `${manifest.quoteToken.symbol} (Chain ${manifest.quoteToken.chainId})`}
              </span>
            </div>
            {deploymentResult?.deployment.transactionHash && (
              <div className="flex justify-between">
                <span className="text-slate-400">Transaction</span>
                <code className="text-white font-mono text-xs truncate max-w-[200px]">
                  {deploymentResult.deployment.transactionHash}
                </code>
              </div>
            )}
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
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Quote Currency</span>
            <span className="text-white font-medium">
              {manifest.quoteToken.type === "basic-currency" ? (
                manifest.quoteToken.symbol
              ) : (
                <>
                  {manifest.quoteToken.symbol}{" "}
                  <span className="text-slate-400 text-xs font-normal">
                    (Chain {manifest.quoteToken.chainId})
                  </span>
                </>
              )}
            </span>
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
