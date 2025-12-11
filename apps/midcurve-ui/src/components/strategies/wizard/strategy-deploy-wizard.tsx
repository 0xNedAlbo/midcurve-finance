"use client";

import { useState, useCallback } from "react";
import { X, ArrowLeft, ArrowRight } from "lucide-react";
import type { SerializedStrategyManifest, DeployStrategyResponse } from "@midcurve/api-shared";

import { useStrategyManifests } from "@/hooks/strategies/useStrategyManifests";
import { useDeployStrategy } from "@/hooks/strategies/useDeployStrategy";

import { ManifestSelectionStep } from "./manifest-selection-step";
import { StrategyConfigurationStep } from "./strategy-configuration-step";
import { DeployReviewStep } from "./deploy-review-step";

interface StrategyDeployWizardProps {
  isOpen: boolean;
  onClose?: () => void;
  onStrategyDeployed?: (response: DeployStrategyResponse) => void;
}

export function StrategyDeployWizard({
  isOpen,
  onClose,
  onStrategyDeployed,
}: StrategyDeployWizardProps) {
  const TOTAL_STEPS = 3;

  // Wizard state
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [selectedManifest, setSelectedManifest] = useState<SerializedStrategyManifest | null>(null);
  const [strategyName, setStrategyName] = useState<string>("");

  // Validation flags
  const [isManifestSelected, setIsManifestSelected] = useState<boolean>(false);
  const [isConfigurationValid, setIsConfigurationValid] = useState<boolean>(false);

  // Deployment state
  const [deploymentResult, setDeploymentResult] = useState<DeployStrategyResponse | null>(null);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);

  // Fetch manifests
  const {
    data: manifestsData,
    isLoading: isLoadingManifests,
    error: manifestsError,
  } = useStrategyManifests({ isActive: true });

  // Deploy mutation
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
    setSelectedManifest(null);
    setStrategyName("");
    setIsManifestSelected(false);
    setIsConfigurationValid(false);
    setDeploymentResult(null);
    setDeploymentError(null);

    onClose?.();
  }, [currentStep, deploymentResult, onClose]);

  // Handle manifest selection
  const handleManifestSelect = (manifest: SerializedStrategyManifest) => {
    setSelectedManifest(manifest);
    setIsManifestSelected(true);
  };

  // Handle deploy
  const handleDeploy = useCallback(() => {
    if (!selectedManifest) return;

    setDeploymentError(null);

    deployMutation.mutate(
      {
        manifestSlug: selectedManifest.slug,
        name: strategyName,
        // constructorValues and config are empty for current simple manifest
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
  }, [selectedManifest, strategyName, deployMutation, onStrategyDeployed]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setDeploymentError(null);
    handleDeploy();
  }, [handleDeploy]);

  // Validation logic for "Next" button
  const canGoNext = useCallback(() => {
    // Step 0 (Manifest Selection): Need manifest selected
    if (currentStep === 0) return isManifestSelected;

    // Step 1 (Configuration): Need valid configuration
    if (currentStep === 1) return isConfigurationValid;

    // Step 2 (Review): No validation (deploy button handles action)
    if (currentStep === 2) return false; // No "Next" on last step

    return false;
  }, [currentStep, isManifestSelected, isConfigurationValid]);

  // Get step title
  const getStepTitle = (step: number): string => {
    switch (step) {
      case 0:
        return "Select Strategy Template";
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
          <ManifestSelectionStep
            manifests={manifestsData?.manifests ?? []}
            isLoading={isLoadingManifests}
            error={manifestsError}
            selectedManifest={selectedManifest}
            onManifestSelect={handleManifestSelect}
          />
        );
      case 1:
        return selectedManifest ? (
          <StrategyConfigurationStep
            manifest={selectedManifest}
            strategyName={strategyName}
            onNameChange={setStrategyName}
            onValidationChange={setIsConfigurationValid}
          />
        ) : (
          <div className="text-center text-slate-400">
            Please select a strategy template first.
          </div>
        );
      case 2:
        return selectedManifest ? (
          <DeployReviewStep
            manifest={selectedManifest}
            strategyName={strategyName}
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
