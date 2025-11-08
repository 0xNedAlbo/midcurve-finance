/**
 * Pool Selection Step - UniswapV3 Position Wizard
 *
 * Allows users to select a liquidity pool by fee tier (0.01%, 0.05%, 0.3%, 1%).
 * Displays pool metrics (TVL, volume, fees) fetched from the backend API.
 *
 * Architecture:
 * - No URL parameter management (component-level state only)
 * - No i18n (English hardcoded)
 * - Uses @midcurve/api-shared types
 * - Backend API handles all blockchain reads
 */

'use client';

import { Loader2, AlertCircle, Zap, ExternalLink, Copy } from 'lucide-react';
import type { PoolDiscoveryResult } from '@midcurve/shared';
import type { EvmChainSlug } from '@/config/chains';
import type { TokenSearchResult } from '@/hooks/positions/uniswapv3/wizard/useTokenSearch';
import {
  usePoolDiscovery,
  getRecommendedPool,
} from '@/hooks/positions/uniswapv3/wizard/usePoolDiscovery';
import { formatFeeTier, formatUSDValue } from '@/lib/format-helpers';
import { CHAIN_METADATA } from '@/config/chains';

export interface PoolSelectionStepProps {
  /**
   * Selected chain slug
   */
  chain: EvmChainSlug;

  /**
   * Base token (from Step 2)
   */
  baseToken: TokenSearchResult;

  /**
   * Quote token (from Step 2)
   */
  quoteToken: TokenSearchResult;

  /**
   * Currently selected pool (null if none selected)
   */
  selectedPool: PoolDiscoveryResult<'uniswapv3'> | null;

  /**
   * Callback when user selects a pool
   */
  onPoolSelect: (pool: PoolDiscoveryResult<'uniswapv3'>) => void;
}

export function PoolSelectionStep(props: PoolSelectionStepProps) {
  const { chain, baseToken, quoteToken, selectedPool, onPoolSelect } = props;

  // Fetch pools for the selected token pair
  const { pools, isLoading, isError, error, isEmpty } = usePoolDiscovery({
    chain,
    tokenA: baseToken.address,
    tokenB: quoteToken.address,
  });

  // Get recommended pool (highest TVL)
  const recommendedPool = getRecommendedPool(pools);

  // Get explorer URL for a given address
  const getExplorerUrl = (address: string): string => {
    const chainMeta = CHAIN_METADATA[chain];
    return `${chainMeta.explorer}/address/${address}`;
  };

  // Handle pool selection
  const handlePoolSelect = (pool: PoolDiscoveryResult<'uniswapv3'>) => {
    onPoolSelect(pool);
  };

  // Handle copy address to clipboard
  const handleCopyAddress = async (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      // Optional: Add toast notification here in future
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-slate-300">Select the pool with your desired fee tier.</p>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Discovering available pools...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <div>
              <h5 className="text-red-400 font-medium">Failed to discover pools</h5>
              <p className="text-red-200/80 text-sm mt-1">{error || 'An unexpected error occurred'}</p>
            </div>
          </div>
        </div>
      )}

      {/* No Pools Available */}
      {isEmpty && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <h5 className="text-amber-400 font-medium">No Pools Available</h5>
              <p className="text-amber-200/80 text-sm mt-1">
                No liquidity pools exist for this token pair. Try a different pair or check back later.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pool Options */}
      {!isLoading && !isError && pools && pools.length > 0 && (
        <div className="space-y-4">
          {pools.map((poolResult, index) => {
            const isRecommended = recommendedPool?.pool.id === poolResult.pool.id;
            const isSelected = selectedPool?.pool.id === poolResult.pool.id;

            // Extract token info from pool
            const token0 = poolResult.pool.token0;
            const token1 = poolResult.pool.token1;

            return (
              <button
                key={`${poolResult.pool.id}-${index}`}
                onClick={() => handlePoolSelect(poolResult)}
                className={`w-full p-6 border-2 rounded-xl transition-all text-left cursor-pointer ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
                }`}
              >
                {/* Header: Token Pair + Recommended Badge */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {/* Overlapping Token Logos */}
                    <div className="flex items-center">
                      {/* Token 0 Logo (z-10) */}
                      <div className="relative z-10">
                        {token0.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={token0.logoUrl}
                            alt={token0.symbol}
                            className="w-8 h-8 rounded-full border-2 border-slate-800 bg-slate-800"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full border-2 border-slate-800 bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-300">
                            {token0.symbol.charAt(0) || '?'}
                          </div>
                        )}
                      </div>
                      {/* Token 1 Logo (z-0, negative margin for overlap) */}
                      <div className="relative -ml-3 z-0">
                        {token1.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={token1.logoUrl}
                            alt={token1.symbol}
                            className="w-8 h-8 rounded-full border-2 border-slate-800 bg-slate-800"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full border-2 border-slate-800 bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-300">
                            {token1.symbol.charAt(0) || '?'}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Token Pair Name + Fee + Address */}
                    <div className="ml-2">
                      <h4 className="text-lg font-semibold text-white">
                        {token0.symbol}/{token1.symbol}
                      </h4>
                      <div className="flex items-center gap-2">
                        {/* Fee Badge */}
                        <div className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm font-medium">
                          {formatFeeTier(poolResult.fee)}
                        </div>
                        <span className="text-xs text-slate-400">{formatFeeTier(poolResult.fee)} Pool</span>
                        {/* Pool Address with Copy & Explorer Link */}
                        <div className="flex items-center gap-1 ml-2">
                          <span className="text-xs text-slate-500 font-mono">
                            {poolResult.pool.config.address.slice(0, 6)}...{poolResult.pool.config.address.slice(-4)}
                          </span>
                          {/* Copy Address Button */}
                          <span
                            onClick={(e) => handleCopyAddress(poolResult.pool.config.address, e)}
                            className="text-slate-400 hover:text-slate-200 transition-colors p-0.5 cursor-pointer inline-flex items-center justify-center"
                            title="Copy address to clipboard"
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                handleCopyAddress(poolResult.pool.config.address, e as any);
                              }
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </span>
                          {/* Explorer Link Button */}
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(getExplorerUrl(poolResult.pool.config.address), '_blank');
                            }}
                            className="text-slate-400 hover:text-slate-200 transition-colors p-0.5 cursor-pointer inline-flex items-center justify-center"
                            title="View on blockchain explorer"
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                window.open(getExplorerUrl(poolResult.pool.config.address), '_blank');
                              }
                            }}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Recommended Badge */}
                  {isRecommended && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-full text-sm font-medium">
                      <Zap className="w-3 h-3" />
                      Recommended
                    </div>
                  )}
                </div>

                {/* Metrics Grid: TVL, Volume 24h, Fees 24h */}
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400 mb-1 text-xs">TVL</p>
                    <p className="text-white font-medium text-base">
                      {formatUSDValue(poolResult.tvlUSD)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-1 text-xs">Volume 24h</p>
                    <p className="text-white font-medium text-base">
                      {formatUSDValue(poolResult.volumeUSD)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-1 text-xs">Fees 24h</p>
                    <p className="text-white font-medium text-base">
                      {formatUSDValue(poolResult.feesUSD)}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Fee Tier Explanation Card */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
        <h4 className="text-white font-semibold mb-2">Fee Tier Explanation</h4>
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <span className="text-blue-400 font-medium">0.05%:</span> For stable pairs with low
            volatility
          </p>
          <p>
            <span className="text-green-400 font-medium">0.3%:</span> Standard fee for most pairs
          </p>
          <p>
            <span className="text-amber-400 font-medium">1.0%:</span> For volatile or exotic pairs
          </p>
        </div>
      </div>
    </div>
  );
}
