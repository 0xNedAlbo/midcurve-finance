"use client";

import { useState, useCallback, useMemo } from "react";
import { X, ArrowLeft, ArrowRight } from "lucide-react";
import type { StrategyManifest } from "@midcurve/shared";
import { hasUserInputParams } from "@midcurve/shared";
import type { DeployStrategyResponse } from "@midcurve/api-shared";

import { useVerifyManifest } from "@/hooks/strategies/useVerifyManifest";
import { useDeployStrategy } from "@/hooks/strategies/useDeployStrategy";

import { ManifestUploadStep } from "./manifest-upload-step";
import { StrategyConfigurationStep } from "./strategy-configuration-step";
import { DeployReviewStep } from "./deploy-review-step";

interface StrategyDeployWizardProps {
  isOpen: boolean;
  onClose?: () => void;
  onStrategyDeployed?: (response: DeployStrategyResponse) => void;
}

/**
 * Strategy deployment wizard with manifest upload flow
 *
 * Steps:
 * 1. Upload Manifest - Upload and validate manifest JSON file
 * 2. Configure - Set strategy name and fill in constructor values
 * 3. Review & Deploy - Review settings and deploy
 */
export function StrategyDeployWizard({
  isOpen,
  onClose,
  onStrategyDeployed,
}: StrategyDeployWizardProps) {
  const TOTAL_STEPS = 3;

  // Wizard state
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [verifiedManifest, setVerifiedManifest] = useState<StrategyManifest | null>(null);
  const [strategyName, setStrategyName] = useState<string>("");
  const [constructorValues, setConstructorValues] = useState<Record<string, string>>({});

  // Validation flags
  const [isManifestValid, setIsManifestValid] = useState<boolean>(false);
  const [isConfigurationValid, setIsConfigurationValid] = useState<boolean>(false);

  // Verification state
  const [verificationErrors, setVerificationErrors] = useState<string[]>([]);
  const [verificationWarnings, setVerificationWarnings] = useState<string[]>([]);

  // Deployment state
  const [deploymentResult, setDeploymentResult] = useState<DeployStrategyResponse | null>(null);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);

  // Mutations
  const verifyMutation = useVerifyManifest();
  const deployMutation = useDeployStrategy();

  // Handle closing wizard with confirmation if progress made
  const handleClose = useCallback(() => {
    if (currentStep > 0 && !deploymentResult) {
      const confirmed = window.confirm(
        "Close wizard? Your progress will be lost."
      );
      if (!confirmed) return;
    }

    // Reset all state
    setCurrentStep(0);
    setVerifiedManifest(null);
    setStrategyName("");
    setConstructorValues({});
    setIsManifestValid(false);
    setIsConfigurationValid(false);
    setVerificationErrors([]);
    setVerificationWarnings([]);
    setDeploymentResult(null);
    setDeploymentError(null);

    onClose?.();
  }, [currentStep, deploymentResult, onClose]);

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
              setIsManifestValid(true);
              setVerificationWarnings(
                response.warnings.map((w) => w.message)
              );
            } else {
              setVerifiedManifest(null);
              setIsManifestValid(false);
              setVerificationErrors(
                response.errors.map((e) => e.message)
              );
            }
          },
          onError: (error) => {
            setVerifiedManifest(null);
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
    setIsManifestValid(false);
    setVerificationErrors([]);
    setVerificationWarnings([]);
    setConstructorValues({});
  }, []);

  // Handle deploy
  const handleDeploy = useCallback(() => {
    if (!verifiedManifest) return;

    setDeploymentError(null);

    // TODO: Add quote token selection UI
    // For now, use a placeholder quote token ID
    const PLACEHOLDER_QUOTE_TOKEN_ID = "placeholder-quote-token";

    deployMutation.mutate(
      {
        manifest: verifiedManifest,
        name: strategyName,
        constructorValues,
        quoteTokenId: PLACEHOLDER_QUOTE_TOKEN_ID,
      },
      {
        onSuccess: (response) => {
          setDeploymentResult(response);
          onStrategyDeployed?.(response);
        },
        onError: (error) => {
          setDeploymentError(error.message || "Deployment failed");
        },
      }
    );
  }, [verifiedManifest, strategyName, constructorValues, deployMutation, onStrategyDeployed]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setDeploymentError(null);
    handleDeploy();
  }, [handleDeploy]);

  // Check if manifest has user-input params
  const manifestHasUserParams = useMemo(() => {
    if (!verifiedManifest) return false;
    return hasUserInputParams(verifiedManifest);
  }, [verifiedManifest]);

  // Validation logic for "Next" button
  const canGoNext = useCallback(() => {
    // Step 0 (Upload Manifest): Need valid manifest
    if (currentStep === 0) return isManifestValid;

    // Step 1 (Configuration): Need valid name and constructor values
    if (currentStep === 1) return isConfigurationValid;

    // Step 2 (Review): No "Next" on last step
    if (currentStep === 2) return false;

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
        return "Review & Deploy";
      default:
        return "";
    }
  };

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
            deploymentResult={deploymentResult}
            deploymentError={deploymentError}
            isDeploying={deployMutation.isPending}
            onDeploy={handleDeploy}
            onRetry={handleRetry}
          />
        ) : (
          <div className="text-center text-slate-400">
            Please complete the previous steps first.
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
    setCurrentStep((prev) => prev - 1);
  };

  // Check if we're on the final step and deployment succeeded
  const isDeploymentComplete =
    deploymentResult?.deployment.status === "confirmed";

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
            <div className="flex items-center gap-2">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i <= currentStep ? "bg-blue-500" : "bg-slate-600"
                  }`}
                />
              ))}
            </div>
          </div>

          <button
            onClick={handleClose}
            className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
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
            {/* Back button (not shown on first step or when deploying/deployed) */}
            {currentStep > 0 && !deployMutation.isPending && !isDeploymentComplete && (
              <button
                onClick={goBack}
                className="flex items-center gap-2 px-4 py-2 text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            )}

            {/* Next button (not shown on last step) */}
            {currentStep < TOTAL_STEPS - 1 && (
              <button
                onClick={goNext}
                disabled={!canGoNext()}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors cursor-pointer"
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {/* Close button (shown when deployment is complete) */}
            {currentStep === TOTAL_STEPS - 1 && isDeploymentComplete && (
              <button
                onClick={handleClose}
                className="px-6 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
