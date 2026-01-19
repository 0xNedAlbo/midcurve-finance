/**
 * Source Token Selector Component
 *
 * Dropdown for selecting the source token to swap from.
 * Uses CoinGecko-powered token search for high-quality token data.
 * Shows token balances, logos, and explorer links.
 */

'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { SwapToken } from '@midcurve/api-shared';
import { useTokenSearch } from '@/hooks/positions/uniswapv3/wizard/useTokenSearch';
import {
  type EvmChainSlug,
  getChainId,
  getChainMetadataByChainId,
} from '@/config/chains';
import { apiClient } from '@/lib/api-client';

interface SourceTokenSelectorProps {
  chain: EvmChainSlug;
  selectedToken: SwapToken | null;
  onSelect: (token: SwapToken | null) => void;
  /** Optional: exclude these token addresses from results (e.g., target token) */
  excludeAddresses?: string[];
}

/**
 * Token selector dropdown with search and balance display
 */
export function SourceTokenSelector({
  chain,
  selectedToken,
  onSelect,
  excludeAddresses = [],
}: SourceTokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get chainId for balance queries
  const chainId = getChainId(chain);

  // Use CoinGecko-powered token search
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    isLoading,
    hasSearched,
  } = useTokenSearch({ chain, enabled: isOpen });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Map search results to SwapToken format and filter excluded addresses
  const filteredTokens: SwapToken[] = useMemo(() => {
    const excludeLower = excludeAddresses.map((a) => a.toLowerCase());
    return searchResults
      .filter((r) => !excludeLower.includes(r.address.toLowerCase()))
      .map((result) => ({
        address: result.address,
        symbol: result.symbol,
        name: result.name,
        decimals: result.decimals,
        logoUrl: result.logoUrl,
      }));
  }, [searchResults, excludeAddresses]);

  // Handle token selection - discover token to get proper decimals
  const handleSelect = useCallback(
    async (token: SwapToken) => {
      setIsDiscovering(true);
      setDiscoveryError(null);

      try {
        // Call token discovery API to get proper decimals from on-chain
        const response = await apiClient.post<{
          id: string;
          symbol: string;
          name: string;
          decimals: number;
          logoUrl?: string;
          config: { address: string; chainId: number };
        }>('/api/v1/tokens/erc20', {
          address: token.address,
          chainId,
        });

        // Create enriched token with correct decimals
        const enrichedToken: SwapToken = {
          address: token.address,
          symbol: response.data.symbol,
          name: response.data.name,
          decimals: response.data.decimals,
          logoUrl: response.data.logoUrl || token.logoUrl,
        };

        onSelect(enrichedToken);
        setIsOpen(false);
        setSearchQuery('');
      } catch (err) {
        // If discovery fails, still allow selection with search decimals (user can try)
        console.error('Token discovery failed:', err);
        setDiscoveryError('Could not verify token. Decimals may be incorrect.');
        // Still select the token from search results
        onSelect(token);
        setIsOpen(false);
        setSearchQuery('');
      } finally {
        setIsDiscovering(false);
      }
    },
    [chainId, onSelect, setSearchQuery]
  );

  return (
    <div className="mb-4" ref={dropdownRef}>
      <div className="text-sm text-slate-400 mb-2">Swap from</div>

      {/* Discovery error message */}
      {discoveryError && (
        <div className="mb-2 text-xs text-amber-400">{discoveryError}</div>
      )}

      {/* Selected Token / Trigger */}
      <button
        onClick={() => !isDiscovering && setIsOpen(!isOpen)}
        disabled={isDiscovering}
        className="w-full bg-slate-900/50 hover:bg-slate-900/70 border border-slate-700/50 rounded-lg p-4 flex items-center justify-between transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
      >
        {isDiscovering ? (
          <span className="text-slate-400">
            <span className="inline-block animate-spin mr-2">⟳</span>
            Verifying token...
          </span>
        ) : selectedToken ? (
          <div className="flex items-center gap-3 text-left">
            {selectedToken.logoUrl && (
              <img
                src={selectedToken.logoUrl}
                alt={selectedToken.symbol}
                className="w-8 h-8 rounded-full"
              />
            )}
            <div>
              <div className="font-semibold text-white">{selectedToken.symbol}</div>
              <a
                href={`${getChainMetadataByChainId(chainId)?.explorer}/token/${selectedToken.address}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-slate-500 font-mono hover:text-amber-400 transition-colors"
              >
                {selectedToken.address.slice(0, 6)}...{selectedToken.address.slice(-4)}
              </a>
            </div>
          </div>
        ) : (
          <span className="text-slate-400">Search for a token...</span>
        )}
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-2 w-full max-w-md bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-80 overflow-hidden">
          {/* Search Input */}
          <div className="p-3 border-b border-slate-700">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or address..."
              className="w-full bg-slate-900/50 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              autoFocus
            />
          </div>

          {/* Token List */}
          <div className="overflow-y-auto max-h-56">
            {/* Loading state */}
            {isLoading && (
              <div className="p-4 text-center text-slate-400">
                <span className="inline-block animate-spin mr-2">⟳</span>
                Searching...
              </div>
            )}

            {/* Empty state - prompt to search */}
            {!isLoading && !hasSearched && searchQuery.length < 2 && (
              <div className="p-4 text-center text-slate-400">
                Type at least 2 characters to search
              </div>
            )}

            {/* No results */}
            {!isLoading && hasSearched && filteredTokens.length === 0 && (
              <div className="p-4 text-center text-slate-400">
                No tokens found for "{searchQuery}"
              </div>
            )}

            {/* Results list */}
            {!isLoading && filteredTokens.length > 0 && (
              filteredTokens.slice(0, 50).map((token) => (
                <TokenRow
                  key={token.address}
                  token={token}
                  chainId={chainId}
                  isSelected={selectedToken?.address === token.address}
                  onSelect={() => handleSelect(token)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Individual token row in the dropdown
 */
function TokenRow({
  token,
  chainId,
  isSelected,
  onSelect,
}: {
  token: SwapToken;
  chainId: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const explorerUrl = getChainMetadataByChainId(chainId)?.explorer;

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 p-3 hover:bg-slate-700/50 transition-colors cursor-pointer ${
        isSelected ? 'bg-amber-500/10' : ''
      }`}
    >
      {token.logoUrl ? (
        <img
          src={token.logoUrl}
          alt={token.symbol}
          className="w-8 h-8 rounded-full"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs text-slate-400">
          {token.symbol.slice(0, 2)}
        </div>
      )}
      <div className="text-left">
        <div className="font-medium text-white">{token.symbol}</div>
        {explorerUrl ? (
          <a
            href={`${explorerUrl}/token/${token.address}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-slate-500 font-mono hover:text-amber-400 transition-colors"
          >
            {token.address.slice(0, 6)}...{token.address.slice(-4)}
          </a>
        ) : (
          <span className="text-xs text-slate-500 font-mono">
            {token.address.slice(0, 6)}...{token.address.slice(-4)}
          </span>
        )}
      </div>
    </button>
  );
}
