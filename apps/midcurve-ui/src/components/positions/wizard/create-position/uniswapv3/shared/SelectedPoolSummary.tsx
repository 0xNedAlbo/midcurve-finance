/**
 * SelectedPoolSummary Component
 *
 * Displays the currently selected/discovered pool in the wizard summary panel.
 * Shows loading state during discovery, error state if failed, or pool info if successful.
 */

import { ExternalLink, AlertCircle, Loader2, Coins, ArrowLeftRight } from 'lucide-react';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { PoolSearchResultItem, PoolSearchTokenInfo } from '@midcurve/api-shared';
import { buildAddressUrl } from '@/lib/explorer-utils';
import { getChainMetadataByChainId } from '@/config/chains';

/**
 * Overlapping token logo pair component
 */
function TokenLogoPair({
  logo0,
  logo1,
  symbol0,
  symbol1,
}: {
  logo0?: string | null;
  logo1?: string | null;
  symbol0: string;
  symbol1: string;
}) {
  return (
    <div className="flex items-center -space-x-2 mr-2">
      {/* Token 0 logo */}
      {logo0 ? (
        <img
          src={logo0}
          alt={symbol0}
          className="w-6 h-6 rounded-full ring-2 ring-slate-800 bg-slate-700"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.nextElementSibling?.classList.remove('hidden');
          }}
        />
      ) : null}
      {!logo0 && (
        <div className="w-6 h-6 rounded-full ring-2 ring-slate-800 bg-slate-600 flex items-center justify-center">
          <Coins className="w-3 h-3 text-slate-400" />
        </div>
      )}

      {/* Token 1 logo */}
      {logo1 ? (
        <img
          src={logo1}
          alt={symbol1}
          className="w-6 h-6 rounded-full ring-2 ring-slate-800 bg-slate-700"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.nextElementSibling?.classList.remove('hidden');
          }}
        />
      ) : null}
      {!logo1 && (
        <div className="w-6 h-6 rounded-full ring-2 ring-slate-800 bg-slate-600 flex items-center justify-center">
          <Coins className="w-3 h-3 text-slate-400" />
        </div>
      )}
    </div>
  );
}

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

  /**
   * Callback to flip quote/base token assignment
   */
  onFlip?: () => void;

  /**
   * The base token (shown on left)
   */
  baseToken?: PoolSearchTokenInfo | null;

  /**
   * The quote token (shown on right)
   */
  quoteToken?: PoolSearchTokenInfo | null;
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
  onFlip,
  baseToken,
  quoteToken,
}: SelectedPoolSummaryProps) {
  // No pool selected yet
  if (!selectedPool && !discoveredPool) {
    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Selected Pool</p>
        <p className="text-slate-500 text-sm">No pool selected</p>
      </div>
    );
  }

  // Discovery in progress
  if (isDiscovering) {
    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <p className="text-xs text-slate-400 mb-2">Selected Pool</p>
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
        <p className="text-xs text-slate-400 mb-2">Selected Pool</p>
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
    const token0Address = (discoveredPool.token0.config.address as string).toLowerCase();
    const token0Logo = discoveredPool.token0.logoUrl;
    const token1Logo = discoveredPool.token1.logoUrl;
    const feeBps = discoveredPool.feeBps;
    const chainMeta = getChainMetadataByChainId(chainId);
    const chainName = chainMeta?.shortName ?? `Chain ${chainId}`;

    // Use base/quote tokens from state if available, fallback to token0/token1
    const baseSymbol = baseToken?.symbol ?? discoveredPool.token0.symbol;
    const quoteSymbol = quoteToken?.symbol ?? discoveredPool.token1.symbol;

    // Map logos based on which token is base/quote
    const baseAddress = baseToken?.address.toLowerCase();
    const baseLogo = baseAddress === token0Address ? token0Logo : token1Logo;
    const quoteLogo = baseAddress === token0Address ? token1Logo : token0Logo;

    return (
      <div className="p-3 bg-slate-700/30 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-slate-400">Selected Pool</p>
          {onFlip && (
            <button
              onClick={onFlip}
              className="flex items-center gap-1 px-2 py-1 bg-slate-600/50 rounded text-xs text-slate-300 hover:bg-slate-600 hover:text-white transition-colors cursor-pointer"
              title="Flip quote/base token"
            >
              <ArrowLeftRight className="w-3 h-3" />
              Flip
            </button>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <TokenLogoPair
              logo0={baseLogo}
              logo1={quoteLogo}
              symbol0={baseSymbol}
              symbol1={quoteSymbol}
            />
            <div>
              <span className="text-white font-medium">
                {baseSymbol} / {quoteSymbol}
              </span>
              <span className="text-slate-400 text-sm ml-2">
                {chainName} · {formatFeeTier(feeBps)}
              </span>
            </div>
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
        <p className="text-xs text-slate-400 mb-2">Selected Pool</p>
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
