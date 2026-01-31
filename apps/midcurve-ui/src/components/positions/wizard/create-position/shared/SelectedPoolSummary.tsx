/**
 * SelectedPoolSummary Component
 *
 * Displays the currently selected/discovered pool in the wizard summary panel.
 * Shows loading state during discovery, error state if failed, or pool info if successful.
 */

import { ExternalLink, AlertCircle, Loader2 } from 'lucide-react';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { PoolSearchResultItem } from '@midcurve/api-shared';
import { buildAddressUrl } from '@/lib/explorer-utils';
import { getChainMetadataByChainId } from '@/config/chains';

interface SelectedPoolSummaryProps {
  /**
   * The lightweight pool info from search/lookup (shown during discovery)
   */
  selectedPool: PoolSearchResultItem | null;

  /**
   * The fully populated pool object from the API
   */
  discoveredPool: UniswapV3Pool | null;

  /**
   * Whether pool discovery is in progress
   */
  isDiscovering: boolean;

  /**
   * Error message if discovery failed
   */
  discoverError: string | null;
}

/**
 * Format fee tier for display (e.g., 3000 -> "0.30%")
 */
function formatFeeTier(feeBps: number): string {
  return `${(feeBps / 10000).toFixed(2)}%`;
}

export function SelectedPoolSummary({
  selectedPool,
  discoveredPool,
  isDiscovering,
  discoverError,
}: SelectedPoolSummaryProps) {
  // No pool selected yet
  if (!selectedPool && !discoveredPool) {
    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Current Pool</p>
        <p className="text-slate-500 text-sm">No pool selected</p>
      </div>
    );
  }

  // Discovery in progress
  if (isDiscovering) {
    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Current Pool</p>
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Discovering pool...</span>
        </div>
      </div>
    );
  }

  // Discovery failed
  if (discoverError) {
    return (
      <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Current Pool</p>
        <div className="flex items-start gap-2 text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Discovery failed</p>
            <p className="text-xs text-red-400/80 mt-1">{discoverError}</p>
          </div>
        </div>
      </div>
    );
  }

  // Pool discovered successfully - use discoveredPool for full data
  if (discoveredPool) {
    // Access config properties (pool is serialized as plain JSON, not class instance)
    const chainId = discoveredPool.config.chainId as number;
    const address = discoveredPool.config.address as string;
    const token0Symbol = discoveredPool.token0.symbol;
    const token1Symbol = discoveredPool.token1.symbol;
    const feeBps = discoveredPool.feeBps;
    const chainMeta = getChainMetadataByChainId(chainId);
    const chainName = chainMeta?.shortName ?? `Chain ${chainId}`;

    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Current Pool</p>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-white font-medium">
              {token0Symbol} / {token1Symbol}
            </span>
            <span className="text-slate-400 text-sm ml-2">
              {chainName} · {formatFeeTier(feeBps)}
            </span>
          </div>
          <a
            href={buildAddressUrl(chainId, address)}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-slate-400 hover:text-blue-400 transition-colors cursor-pointer"
            title="View on explorer"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  // Fallback: show selectedPool info (shouldn't happen in normal flow)
  if (selectedPool) {
    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Current Pool</p>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-white font-medium">
              {selectedPool.token0.symbol} / {selectedPool.token1.symbol}
            </span>
            <span className="text-slate-400 text-sm ml-2">
              {selectedPool.chainName} · {formatFeeTier(selectedPool.feeTier)}
            </span>
          </div>
          <a
            href={buildAddressUrl(selectedPool.chainId, selectedPool.poolAddress)}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-slate-400 hover:text-blue-400 transition-colors cursor-pointer"
            title="View on explorer"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  return null;
}
