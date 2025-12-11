"use client";

import { useEffect } from "react";
import { Shield, Info } from "lucide-react";
import type { SerializedStrategyManifest } from "@midcurve/api-shared";

interface StrategyConfigurationStepProps {
  manifest: SerializedStrategyManifest;
  strategyName: string;
  onNameChange: (name: string) => void;
  onValidationChange: (isValid: boolean) => void;
}

export function StrategyConfigurationStep({
  manifest,
  strategyName,
  onNameChange,
  onValidationChange,
}: StrategyConfigurationStepProps) {
  // Validation: name is required and 1-100 chars
  const isNameValid = strategyName.trim().length >= 1 && strategyName.length <= 100;

  // Report validation state to parent
  useEffect(() => {
    onValidationChange(isNameValid);
  }, [isNameValid, onValidationChange]);

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
              {manifest.isAudited && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="flex items-center gap-1 text-green-400">
                    <Shield className="w-3 h-3" />
                    Audited
                  </span>
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

      {/* Capabilities Summary */}
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
        <h4 className="text-sm font-medium text-slate-300 mb-3">
          What this strategy can do:
        </h4>
        <ul className="space-y-2 text-sm">
          {manifest.capabilities.funding && (
            <li className="flex items-start gap-2 text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
              <span>Accept deposits and process withdrawals</span>
            </li>
          )}
          {manifest.capabilities.uniswapV3Actions && (
            <li className="flex items-start gap-2 text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-2 flex-shrink-0" />
              <span>Manage Uniswap V3 positions (mint, burn, collect)</span>
            </li>
          )}
          {manifest.capabilities.ohlcConsumer && (
            <li className="flex items-start gap-2 text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-2 flex-shrink-0" />
              <span>Receive price feed updates (OHLC data)</span>
            </li>
          )}
          {manifest.capabilities.poolConsumer && (
            <li className="flex items-start gap-2 text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 flex-shrink-0" />
              <span>Receive pool state updates</span>
            </li>
          )}
          {manifest.capabilities.balanceConsumer && (
            <li className="flex items-start gap-2 text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-400 mt-2 flex-shrink-0" />
              <span>Track token balances</span>
            </li>
          )}
        </ul>
      </div>

      {/* Future: Dynamic parameter fields would go here */}
      {/* When manifests have user-input constructor params or userParams,
          we would render dynamic form fields based on param definitions */}
    </div>
  );
}
