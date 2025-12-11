"use client";

import { Loader2, Shield, CheckCircle } from "lucide-react";
import type { SerializedStrategyManifest } from "@midcurve/api-shared";

interface ManifestSelectionStepProps {
  manifests: SerializedStrategyManifest[];
  isLoading: boolean;
  error: Error | null;
  selectedManifest: SerializedStrategyManifest | null;
  onManifestSelect: (manifest: SerializedStrategyManifest) => void;
}

export function ManifestSelectionStep({
  manifests,
  isLoading,
  error,
  selectedManifest,
  onManifestSelect,
}: ManifestSelectionStepProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p>Loading available strategies...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
        <p className="text-red-400 font-medium mb-2">Failed to load strategies</p>
        <p className="text-slate-400 text-sm">{error.message}</p>
      </div>
    );
  }

  if (manifests.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-6 text-center">
        <p className="text-slate-300 font-medium mb-2">No strategies available</p>
        <p className="text-slate-400 text-sm">
          There are no active strategy templates available for deployment at this time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-slate-300">
        Select a strategy template to deploy. Each strategy has different capabilities
        and risk profiles.
      </p>

      <div className="grid gap-4">
        {manifests.map((manifest) => (
          <button
            key={manifest.slug}
            onClick={() => onManifestSelect(manifest)}
            className={`p-4 border-2 rounded-lg transition-all text-left cursor-pointer ${
              selectedManifest?.slug === manifest.slug
                ? "border-blue-500 bg-blue-500/10"
                : "border-slate-700 hover:border-slate-600 bg-slate-800/50"
            }`}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <h4 className="text-lg font-semibold text-white">
                  {manifest.name}
                </h4>
                <p className="text-slate-400 text-xs">
                  v{manifest.version} {manifest.author && `by ${manifest.author}`}
                </p>
              </div>

              {/* Badges */}
              <div className="flex items-center gap-2">
                {manifest.isAudited && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 text-green-400 rounded text-xs">
                    <Shield className="w-3 h-3" />
                    Audited
                  </span>
                )}
                {selectedManifest?.slug === manifest.slug && (
                  <CheckCircle className="w-5 h-5 text-blue-500" />
                )}
              </div>
            </div>

            {/* Description */}
            <p className="text-slate-300 text-sm mb-3 line-clamp-2">
              {manifest.description}
            </p>

            {/* Tags */}
            {manifest.tags && manifest.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {manifest.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-slate-700/50 text-slate-300 rounded text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Capabilities */}
            <div className="mt-3 pt-3 border-t border-slate-700/50">
              <p className="text-slate-400 text-xs mb-1.5">Capabilities:</p>
              <div className="flex flex-wrap gap-1.5">
                {manifest.capabilities.funding && (
                  <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs">
                    Funding
                  </span>
                )}
                {manifest.capabilities.uniswapV3Actions && (
                  <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded text-xs">
                    Uniswap V3
                  </span>
                )}
                {manifest.capabilities.ohlcConsumer && (
                  <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded text-xs">
                    Price Feeds
                  </span>
                )}
                {manifest.capabilities.poolConsumer && (
                  <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 rounded text-xs">
                    Pool Data
                  </span>
                )}
                {manifest.capabilities.balanceConsumer && (
                  <span className="px-2 py-0.5 bg-pink-500/10 text-pink-400 rounded text-xs">
                    Balance Tracking
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
        <p className="text-slate-400 text-sm">
          {manifests.length} strateg{manifests.length === 1 ? "y" : "ies"} available.
          Strategies marked as "Audited" have undergone security review.
        </p>
      </div>
    </div>
  );
}
