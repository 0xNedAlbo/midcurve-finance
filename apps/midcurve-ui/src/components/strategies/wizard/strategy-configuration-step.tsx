"use client";

import { useEffect, useCallback } from "react";
import { Info } from "lucide-react";
import type { StrategyManifest } from "@midcurve/shared";

import { ConstructorParamsForm } from "./constructor-params-form";

interface StrategyConfigurationStepProps {
  manifest: StrategyManifest;
  strategyName: string;
  onNameChange: (name: string) => void;
  constructorValues: Record<string, string>;
  onConstructorValuesChange: (values: Record<string, string>) => void;
  onValidationChange: (isValid: boolean) => void;
  hasUserParams: boolean;
  /** ETH amount to fund vault for gas (e.g., "0.1") */
  ethFundingAmount: string;
  onEthFundingAmountChange: (amount: string) => void;
}

export function StrategyConfigurationStep({
  manifest,
  strategyName,
  onNameChange,
  constructorValues,
  onConstructorValuesChange,
  onValidationChange,
  hasUserParams,
  ethFundingAmount,
  onEthFundingAmountChange,
}: StrategyConfigurationStepProps) {
  // Validation: name is required and 1-100 chars
  const isNameValid = strategyName.trim().length >= 1 && strategyName.length <= 100;

  // Validation: ETH amount must be a positive number
  const ethAmountNum = parseFloat(ethFundingAmount);
  const isEthAmountValid = !isNaN(ethAmountNum) && ethAmountNum > 0;

  // Track constructor params validation separately
  const handleParamsValidationChange = useCallback((isValid: boolean) => {
    // Overall validation requires name, ETH amount, and params to be valid
    onValidationChange(isNameValid && isEthAmountValid && isValid);
  }, [isNameValid, isEthAmountValid, onValidationChange]);

  // If no user params, check name and ETH amount validity
  useEffect(() => {
    if (!hasUserParams) {
      onValidationChange(isNameValid && isEthAmountValid);
    }
  }, [hasUserParams, isNameValid, isEthAmountValid, onValidationChange]);

  return (
    <div className="space-y-6">
      {/* Selected Strategy Info */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-slate-300 text-sm mb-2">
              You are deploying: <span className="text-white font-medium">{manifest.name}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">v{manifest.version}</span>
              {manifest.author && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400">by {manifest.author}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Name Input */}
      <div>
        <label
          htmlFor="strategy-name"
          className="block text-sm font-medium text-slate-300 mb-2"
        >
          Strategy Name <span className="text-red-400">*</span>
        </label>
        <input
          id="strategy-name"
          type="text"
          value={strategyName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., My ETH/USDC Strategy"
          maxLength={100}
          className={`w-full px-4 py-3 bg-slate-700 border rounded-lg text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-colors ${
            strategyName.length > 0 && !isNameValid
              ? "border-red-500/50 focus:ring-red-500/50"
              : "border-slate-600 focus:ring-blue-500/50"
          }`}
        />
        <div className="flex justify-between mt-1.5">
          <p className="text-slate-400 text-xs">
            Give your strategy a memorable name to identify it later
          </p>
          <p className={`text-xs ${strategyName.length > 90 ? "text-amber-400" : "text-slate-500"}`}>
            {strategyName.length}/100
          </p>
        </div>
        {strategyName.length > 0 && !isNameValid && (
          <p className="text-red-400 text-xs mt-1">
            Name must be between 1 and 100 characters
          </p>
        )}
      </div>

      {/* ETH Gas Funding Input */}
      <div>
        <label
          htmlFor="eth-funding"
          className="block text-sm font-medium text-slate-300 mb-2"
        >
          Vault Gas Funding (ETH) <span className="text-red-400">*</span>
        </label>
        <div className="relative">
          <input
            id="eth-funding"
            type="number"
            step="0.01"
            min="0"
            value={ethFundingAmount}
            onChange={(e) => onEthFundingAmountChange(e.target.value)}
            placeholder="0.1"
            className={`w-full px-4 py-3 bg-slate-700 border rounded-lg text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-colors pr-14 ${
              ethFundingAmount.length > 0 && !isEthAmountValid
                ? "border-red-500/50 focus:ring-red-500/50"
                : "border-slate-600 focus:ring-blue-500/50"
            }`}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
            ETH
          </span>
        </div>
        <p className="text-slate-400 text-xs mt-1.5">
          ETH deposited to the vault for automation gas costs. The automation wallet will
          use this to pay for on-chain transactions.
        </p>
        {ethFundingAmount.length > 0 && !isEthAmountValid && (
          <p className="text-red-400 text-xs mt-1">
            ETH amount must be greater than 0
          </p>
        )}
        {isEthAmountValid && (
          <p className="text-slate-500 text-xs mt-1">
            Estimated ~{Math.floor(ethAmountNum / 0.001)} transactions at 0.001 ETH average gas
          </p>
        )}
      </div>

      {/* Constructor Parameters Form (if any) */}
      {hasUserParams && (
        <div>
          <h4 className="text-sm font-medium text-slate-300 mb-4">
            Strategy Parameters
          </h4>
          <ConstructorParamsForm
            manifest={manifest}
            values={constructorValues}
            onChange={onConstructorValuesChange}
            onValidationChange={handleParamsValidationChange}
          />
        </div>
      )}

      {/* Info box when no params */}
      {!hasUserParams && (
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
          <p className="text-slate-400 text-sm">
            This strategy has no configurable parameters. System addresses will
            be set automatically during deployment.
          </p>
        </div>
      )}
    </div>
  );
}
