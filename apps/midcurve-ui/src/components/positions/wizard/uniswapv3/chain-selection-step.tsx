"use client";

import { useMemo } from "react";
import { getAllUniswapV3Chains } from "@/config/protocols/uniswapv3";
import type { EvmChainSlug } from "@/config/chains";

interface ChainSelectionStepProps {
  selectedChain: EvmChainSlug | null;
  onChainSelect: (chain: EvmChainSlug) => void;
}

export function ChainSelectionStep({
  selectedChain,
  onChainSelect,
}: ChainSelectionStepProps) {
  const chains = useMemo(() => {
    return getAllUniswapV3Chains().map((chainMetadata) => ({
      id: chainMetadata.slug,
      name: chainMetadata.shortName,
      description:
        chainMetadata.description ||
        `Use ${chainMetadata.name} for your position`,
    }));
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-slate-300">
        Select the blockchain network where you want to create your Uniswap V3
        position
      </p>

      <div className="grid gap-4">
        {chains.map((chain) => (
          <button
            key={chain.id}
            onClick={() => onChainSelect(chain.id)}
            className={`p-4 border-2 rounded-lg transition-all text-left cursor-pointer ${
              selectedChain === chain.id
                ? "border-blue-500 bg-blue-500/10"
                : "border-slate-700 hover:border-slate-600 bg-slate-800/50"
            }`}
          >
            <h4 className="text-lg font-semibold text-white mb-1">
              {chain.name}
            </h4>
            <p className="text-slate-300 text-sm">{chain.description}</p>
          </button>
        ))}
      </div>

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
        <p className="text-slate-400 text-sm">
          Uniswap V3 is available on {chains.length} chains. You can manage
          positions across different chains from your dashboard.
        </p>
      </div>
    </div>
  );
}
