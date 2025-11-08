"use client";

import { useState, useCallback } from "react";
import { X, ArrowLeft, ArrowRight } from "lucide-react";
import type { EvmChainSlug } from "@/config/chains";
import type { PoolDiscoveryResult } from "@midcurve/shared";

import { IntroStep } from "./intro-step";
import { ChainSelectionStep } from "./chain-selection-step";
import { TokenPairStep } from "./token-pair-step";
import { PoolSelectionStep } from "./pool-selection-step";
import { PositionConfigStep, type PositionConfig } from "./position-config-step";
import { OpenPositionStep } from "./open-position-step";
import type { TokenSearchResult } from "@/hooks/positions/uniswapv3/wizard/useTokenSearch";

interface UniswapV3PositionWizardProps {
  isOpen: boolean;
  onClose?: () => void;
  onPositionCreated?: (position: any) => void;
}

export function UniswapV3PositionWizard({
  isOpen,
  onClose,
  onPositionCreated,
}: UniswapV3PositionWizardProps) {
  const TOTAL_STEPS = 6;

  // Wizard state (component-level, not URL-driven)
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [selectedChain, setSelectedChain] = useState<EvmChainSlug | null>(null);
  const [baseToken, setBaseToken] = useState<TokenSearchResult | null>(null);
  const [quoteToken, setQuoteToken] = useState<TokenSearchResult | null>(null);
  const [selectedPool, setSelectedPool] = useState<PoolDiscoveryResult<'uniswapv3'> | null>(null);

  // Step 4 state (Position Configuration)
  const [tickLower, setTickLower] = useState<number | null>(null);
  const [tickUpper, setTickUpper] = useState<number | null>(null);
  const [liquidity, setLiquidity] = useState<bigint>(0n);

  // Validation flags
  const [isChainSelected, setIsChainSelected] = useState<boolean>(false);
  const [isTokenPairSelected, setIsTokenPairSelected] =
    useState<boolean>(false);
  const [isPoolSelected, setIsPoolSelected] = useState<boolean>(false);
  const [isPositionConfigValid, setIsPositionConfigValid] = useState<boolean>(false);
  const [isOpenPositionValid, setIsOpenPositionValid] = useState<boolean>(false);
  const [isPositionCreated, setIsPositionCreated] = useState<boolean>(false);

  // Handle closing wizard with confirmation if progress made
  const handleClose = useCallback(() => {
    if (currentStep > 0 && !isPositionCreated) {
      const confirmed = window.confirm(
        'Close wizard? Your progress will be lost.'
      );
      if (!confirmed) return;
    }

    // Reset all state
    setCurrentStep(0);
    setSelectedChain(null);
    setBaseToken(null);
    setQuoteToken(null);
    setSelectedPool(null);
    setTickLower(null);
    setTickUpper(null);
    setLiquidity(0n);
    setIsChainSelected(false);
    setIsTokenPairSelected(false);
    setIsPoolSelected(false);
    setIsPositionConfigValid(false);
    setIsOpenPositionValid(false);
    setIsPositionCreated(false);

    onClose?.();
  }, [currentStep, isPositionCreated, onClose]);

  // Validation logic for "Next" button
  const canGoNext = useCallback(() => {
    // Step 0 (Intro): Always can proceed
    if (currentStep === 0) return true;

    // Step 1 (Chain Selection): Need chain selected
    if (currentStep === 1) return isChainSelected;

    // Step 2 (Token Pair): Need both tokens selected
    if (currentStep === 2) return isTokenPairSelected;

    // Step 3 (Pool Selection): Need pool selected
    if (currentStep === 3) return isPoolSelected;

    // Step 4 (Position Config): Need valid position configuration
    if (currentStep === 4) return isPositionConfigValid;

    // Step 5 (Open Position): Transaction ready validation
    if (currentStep === 5) return isOpenPositionValid;

    return false;
  }, [currentStep, isChainSelected, isTokenPairSelected, isPoolSelected, isPositionConfigValid, isOpenPositionValid]);

  // Get step title
  const getStepTitle = (step: number): string => {
    switch (step) {
      case 0:
        return "Welcome to Position Wizard";
      case 1:
        return "Select Blockchain";
      case 2:
        return "Choose Token Pair";
      case 3:
        return "Select Pool & Fee Tier";
      case 4:
        return "Configure your position parameters and analyze the risk profile.";
      case 5:
        return "Open Position";
      default:
        return "";
    }
  };

  // Render current step content
  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return <IntroStep />;
      case 1:
        return (
          <ChainSelectionStep
            selectedChain={selectedChain}
            onChainSelect={(chain) => {
              setSelectedChain(chain);
              setIsChainSelected(true);
            }}
          />
        );
      case 2:
        return selectedChain ? (
          <TokenPairStep
            chain={selectedChain}
            baseToken={baseToken}
            quoteToken={quoteToken}
            onTokenPairSelect={(base, quote) => {
              setBaseToken(base);
              setQuoteToken(quote);
              setIsTokenPairSelected(true);
            }}
          />
        ) : (
          <div className="text-center text-slate-400">
            Please select a chain first.
          </div>
        );
      case 3:
        return selectedChain && baseToken && quoteToken ? (
          <PoolSelectionStep
            chain={selectedChain}
            baseToken={baseToken}
            quoteToken={quoteToken}
            selectedPool={selectedPool}
            onPoolSelect={(pool) => {
              setSelectedPool(pool);
              setIsPoolSelected(true);
            }}
          />
        ) : (
          <div className="text-center text-slate-400">
            Please select a token pair first.
          </div>
        );
      case 4:
        return selectedChain && baseToken && quoteToken && selectedPool ? (
          <PositionConfigStep
            chain={selectedChain}
            baseToken={baseToken}
            quoteToken={quoteToken}
            pool={selectedPool}
            tickLower={tickLower}
            tickUpper={tickUpper}
            liquidity={liquidity}
            onConfigChange={(config: PositionConfig) => {
              setTickLower(config.tickLower);
              setTickUpper(config.tickUpper);
              setLiquidity(config.liquidity);
            }}
            onValidationChange={setIsPositionConfigValid}
          />
        ) : (
          <div className="text-center text-slate-400">
            Please select a pool first.
          </div>
        );
      case 5:
        return selectedChain &&
          baseToken &&
          quoteToken &&
          selectedPool &&
          tickLower !== null &&
          tickUpper !== null &&
          liquidity > 0n ? (
          <OpenPositionStep
            chain={selectedChain}
            baseToken={baseToken}
            quoteToken={quoteToken}
            pool={selectedPool}
            tickLower={tickLower}
            tickUpper={tickUpper}
            liquidity={liquidity}
            onLiquidityChange={setLiquidity}
            onPositionCreated={(position) => {
              setIsPositionCreated(true);
              onPositionCreated?.(position);
            }}
            onValidationChange={setIsOpenPositionValid}
          />
        ) : (
          <div className="text-center text-slate-400">
            Please configure your position first.
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
    if (currentStep === TOTAL_STEPS - 1) return;
    setCurrentStep((prev) => prev + 1);
  };

  const goBack = () => {
    if (currentStep === 0) return;
    setCurrentStep((prev) => prev - 1);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop (click ignored - use X button to close) */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-white">
              Create Uniswap V3 Position
            </h2>

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
            {currentStep > 0 && (
              <button
                onClick={goBack}
                className="flex items-center gap-2 px-4 py-2 text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            )}

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

            {currentStep === TOTAL_STEPS - 1 && (
              <button
                onClick={() => {
                  // Position created - close wizard
                  handleClose();
                }}
                disabled={!isPositionCreated}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors cursor-pointer"
              >
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
