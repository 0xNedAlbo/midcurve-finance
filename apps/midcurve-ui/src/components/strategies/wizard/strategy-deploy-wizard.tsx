"use client";

import { useState, useCallback, useMemo } from "react";
import { X, ArrowLeft, ArrowRight } from "lucide-react";
import type { StrategyManifest } from "@midcurve/shared";
import { hasUserInputParams } from "@midcurve/shared";
import type { DeployStrategyResponse, ResolvedFundingToken } from "@midcurve/api-shared";

import { useVerifyManifest } from "@/hooks/strategies/useVerifyManifest";
import { useDeployStrategy } from "@/hooks/strategies/useDeployStrategy";

import { ManifestUploadStep } from "./manifest-upload-step";
import { StrategyConfigurationStep } from "./strategy-configuration-step";
import { DeployReviewStep } from "./deploy-review-step";
import { AutoWalletStep } from "./auto-wallet-step";
import { StrategyDeployStep } from "./strategy-deploy-step";
import { VaultDeployStep } from "./vault-deploy-step";
import { VaultFundStep } from "./vault-fund-step";

interface StrategyDeployWizardProps {
  isOpen: boolean;
  onClose?: () => void;
  onStrategyDeployed?: (response: DeployStrategyResponse) => void;
}

/**
 * Strategy deployment wizard with manifest upload flow
 *
 * Steps:
 * 0. Upload Manifest - Upload and validate manifest JSON file
 * 1. Configure - Set strategy name, constructor values, and ETH funding amount
 * 2. Review - Review all settings before deployment
 * 3. Auto Wallet - Create automation wallet (automatic)
 * 4. Strategy Deploy - Deploy strategy contract (automatic)
 * 5. Vault Deploy - Deploy funding vault (user signs tx)
 * 6. Vault Fund - Fund vault with ETH (user signs tx)
 */
export function StrategyDeployWizard({
  isOpen,
  onClose,
  onStrategyDeployed,
}: StrategyDeployWizardProps) {
  const TOTAL_STEPS = 7;

  // Wizard state
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [verifiedManifest, setVerifiedManifest] = useState<StrategyManifest | null>(null);
  const [resolvedFundingToken, setResolvedFundingToken] = useState<ResolvedFundingToken | null>(null);
  const [strategyName, setStrategyName] = useState<string>("");
  const [constructorValues, setConstructorValues] = useState<Record<string, string>>({});
  const [ethFundingAmount, setEthFundingAmount] = useState<string>("0.1");

  // Validation flags
  const [isManifestValid, setIsManifestValid] = useState<boolean>(false);
  const [isConfigurationValid, setIsConfigurationValid] = useState<boolean>(false);

  // Verification state
  const [verificationErrors, setVerificationErrors] = useState<string[]>([]);
  const [verificationWarnings, setVerificationWarnings] = useState<string[]>([]);

  // Deployment state
  const [deploymentResult, setDeploymentResult] = useState<DeployStrategyResponse | null>(null);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);

  // Vault state
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);

  // Mutations
  const verifyMutation = useVerifyManifest();
  const deployMutation = useDeployStrategy();

  // Check if we're in auto-advancing steps (3 and 4)
  const isAutoAdvancingStep = currentStep === 3 || currentStep === 4;

  // Check if setup is complete (vault funded)
  const isSetupComplete = currentStep === 6 && vaultAddress !== null;

  // Handle closing wizard with confirmation if progress made
  const handleClose = useCallback(() => {
    // Don't allow close during auto-advancing steps
    if (isAutoAdvancingStep) {
      return;
    }

    if (currentStep > 0 && !isSetupComplete) {
      const confirmed = window.confirm(
        "Close wizard? Your progress will be lost."
      );
      if (!confirmed) return;
    }

    // Reset all state
    setCurrentStep(0);
    setVerifiedManifest(null);
    setResolvedFundingToken(null);
    setStrategyName("");
    setConstructorValues({});
    setEthFundingAmount("0.1");
    setIsManifestValid(false);
    setIsConfigurationValid(false);
    setVerificationErrors([]);
    setVerificationWarnings([]);
    setDeploymentResult(null);
    setDeploymentError(null);
    setVaultAddress(null);

    onClose?.();
  }, [currentStep, isAutoAdvancingStep, isSetupComplete, onClose]);

  // Handle manifest verification
  const handleManifestVerify = useCallback(
    (manifest: unknown) => {
      setVerificationErrors([]);
      setVerificationWarnings([]);

      verifyMutation.mutate(
        { manifest },
        {
          onSuccess: (response) => {
            if (response.valid && response.parsedManifest) {
              setVerifiedManifest(response.parsedManifest as unknown as StrategyManifest);
              setResolvedFundingToken(response.resolvedFundingToken ?? null);
              setIsManifestValid(true);
              setVerificationWarnings(
                response.warnings.map((w) => w.message)
              );
            } else {
              setVerifiedManifest(null);
              setResolvedFundingToken(null);
              setIsManifestValid(false);
              setVerificationErrors(
                response.errors.map((e) => e.message)
              );
            }
          },
          onError: (error) => {
            setVerifiedManifest(null);
            setResolvedFundingToken(null);
            setIsManifestValid(false);
            setVerificationErrors([error.message || "Verification failed"]);
          },
        }
      );
    },
    [verifyMutation]
  );

  // Handle manifest cleared
  const handleManifestCleared = useCallback(() => {
    setVerifiedManifest(null);
    setResolvedFundingToken(null);
    setIsManifestValid(false);
    setVerificationErrors([]);
    setVerificationWarnings([]);
    setConstructorValues({});
  }, []);

  // Handle deploy (initiates deployment in step 3)
  const handleDeploy = useCallback(() => {
    if (!verifiedManifest) return;

    setDeploymentError(null);

    deployMutation.mutate(
      {
        manifest: verifiedManifest,
        name: strategyName,
        constructorValues,
      },
      {
        onSuccess: (response) => {
          setDeploymentResult(response);
        },
        onError: (error) => {
          setDeploymentError(error.message || "Deployment failed");
        },
      }
    );
  }, [verifiedManifest, strategyName, constructorValues, deployMutation]);

  // Handle retry deployment
  const handleRetry = useCallback(() => {
    setDeploymentError(null);
    setDeploymentResult(null);
    handleDeploy();
  }, [handleDeploy]);

  // Handle deployment status change (from polling)
  const handleDeploymentStatusChange = useCallback(
    (result: DeployStrategyResponse) => {
      setDeploymentResult(result);
    },
    []
  );

  // Handle auto-wallet ready (advance to step 4)
  const handleWalletReady = useCallback(() => {
    setCurrentStep(4);
  }, []);

  // Handle strategy deployed (advance to step 5)
  const handleStrategyDeployed = useCallback(() => {
    setCurrentStep(5);

    // Also notify parent that strategy is deployed (but vault isn't set up yet)
    if (deploymentResult) {
      onStrategyDeployed?.(deploymentResult);
    }
  }, [deploymentResult, onStrategyDeployed]);

  // Handle vault deployed (advance to step 6)
  const handleVaultDeployed = useCallback((address: string) => {
    setVaultAddress(address);
    setCurrentStep(6);
  }, []);

  // Handle funding complete
  const handleFundingComplete = useCallback(() => {
    // Setup is complete - user can close or navigate from VaultFundStep
  }, []);

  // Check if manifest has user-input params
  const manifestHasUserParams = useMemo(() => {
    if (!verifiedManifest) return false;
    return hasUserInputParams(verifiedManifest);
  }, [verifiedManifest]);

  // Validation logic for "Next" button
  const canGoNext = useCallback(() => {
    // Step 0 (Upload Manifest): Need valid manifest
    if (currentStep === 0) return isManifestValid;

    // Step 1 (Configuration): Need valid name, ETH amount, and constructor values
    if (currentStep === 1) return isConfigurationValid;

    // Step 2 (Review): Always can go next (starts deployment)
    if (currentStep === 2) return true;

    // Steps 3-6: No "Next" button (auto-advance or handled within step)
    return false;
  }, [currentStep, isManifestValid, isConfigurationValid]);

  // Get step title
  const getStepTitle = (step: number): string => {
    switch (step) {
      case 0:
        return "Upload Strategy Manifest";
      case 1:
        return "Configure Your Strategy";
      case 2:
        return "Review Configuration";
      case 3:
        return "Creating Automation Wallet";
      case 4:
        return "Deploying Strategy Contract";
      case 5:
        return "Deploy Funding Vault";
      case 6:
        return "Fund Vault with ETH";
      default:
        return "";
    }
  };

  // Get strategy ID and contract address from deployment result
  const strategyId = deploymentResult?.strategy?.id;
  const strategyAddress = deploymentResult?.deployment.contractAddress;
  const vaultChainId = verifiedManifest?.fundingToken?.chainId;

  // Render current step content
  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <ManifestUploadStep
            verifiedManifest={verifiedManifest}
            onManifestVerified={handleManifestVerify}
            onManifestCleared={handleManifestCleared}
            isVerifying={verifyMutation.isPending}
            verificationErrors={verificationErrors}
            verificationWarnings={verificationWarnings}
          />
        );
      case 1:
        return verifiedManifest ? (
          <StrategyConfigurationStep
            manifest={verifiedManifest}
            strategyName={strategyName}
            onNameChange={setStrategyName}
            constructorValues={constructorValues}
            onConstructorValuesChange={setConstructorValues}
            onValidationChange={setIsConfigurationValid}
            hasUserParams={manifestHasUserParams}
            ethFundingAmount={ethFundingAmount}
            onEthFundingAmountChange={setEthFundingAmount}
          />
        ) : (
          <div className="text-center text-slate-400">
            Please upload a manifest file first.
          </div>
        );
      case 2:
        return verifiedManifest ? (
          <DeployReviewStep
            manifest={verifiedManifest}
            strategyName={strategyName}
            constructorValues={constructorValues}
            ethFundingAmount={ethFundingAmount}
            resolvedFundingToken={resolvedFundingToken ?? undefined}
          />
        ) : (
          <div className="text-center text-slate-400">
            Please complete the previous steps first.
          </div>
        );
      case 3:
        return (
          <AutoWalletStep
            deploymentResult={deploymentResult}
            deploymentError={deploymentError}
            isDeploying={deployMutation.isPending}
            onDeploy={handleDeploy}
            onRetry={handleRetry}
            onDeploymentStatusChange={handleDeploymentStatusChange}
            onWalletReady={handleWalletReady}
          />
        );
      case 4:
        return (
          <StrategyDeployStep
            deploymentResult={deploymentResult}
            onDeploymentStatusChange={handleDeploymentStatusChange}
            onStrategyDeployed={handleStrategyDeployed}
            onRetry={handleRetry}
          />
        );
      case 5:
        return strategyId && strategyAddress ? (
          <VaultDeployStep
            strategyId={strategyId}
            strategyAddress={strategyAddress}
            onVaultDeployed={handleVaultDeployed}
          />
        ) : (
          <div className="text-center text-slate-400">
            Waiting for strategy deployment...
          </div>
        );
      case 6:
        return vaultAddress && vaultChainId ? (
          <VaultFundStep
            vaultAddress={vaultAddress}
            vaultChainId={vaultChainId}
            ethFundingAmount={ethFundingAmount}
            onFundingComplete={handleFundingComplete}
          />
        ) : (
          <div className="text-center text-slate-400">
            Waiting for vault deployment...
          </div>
        );
      default:
        return (
          <div className="text-center text-slate-400">
            This step is not yet implemented.
          </div>
        );
    }
  };

  // Navigation handlers
  const goNext = () => {
    if (currentStep >= TOTAL_STEPS - 1) return;
    setCurrentStep((prev) => prev + 1);
  };

  const goBack = () => {
    if (currentStep === 0) return;
    // Can't go back once deployment has started (step 3+)
    if (currentStep >= 3) return;
    setCurrentStep((prev) => prev - 1);
  };

  // Check if back button should be shown
  const showBackButton =
    currentStep > 0 &&
    currentStep < 3 && // Can only go back in steps 1 and 2
    !deployMutation.isPending;

  // Check if next button should be shown
  const showNextButton =
    currentStep < 3; // Only steps 0, 1, 2 have Next button

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop (click ignored - use X button to close) */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-white">Deploy Strategy</h2>

            {/* Progress Indicator */}
            <div className="flex items-center gap-1.5">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i < currentStep
                      ? "bg-green-500"
                      : i === currentStep
                        ? "bg-blue-500"
                        : "bg-slate-600"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Close button (hidden during auto-advancing steps) */}
          {!isAutoAdvancingStep && (
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Step Title */}
        <div className="px-6 py-4 border-b border-slate-700/30">
          <h3 className="text-lg font-semibold text-white">
            {getStepTitle(currentStep)}
          </h3>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {renderCurrentStep()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-slate-700/50">
          <div className="text-sm text-slate-400">
            Step {currentStep + 1} of {TOTAL_STEPS}
          </div>

          <div className="flex items-center gap-3">
            {/* Back button */}
            {showBackButton && (
              <button
                onClick={goBack}
                className="flex items-center gap-2 px-4 py-2 text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            )}

            {/* Next button */}
            {showNextButton && (
              <button
                onClick={goNext}
                disabled={!canGoNext()}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors cursor-pointer"
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
