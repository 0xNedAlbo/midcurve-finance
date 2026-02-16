/**
 * Token Search Hook
 *
 * Hook for searching tokens with debouncing and caching via React Query.
 * Used in the position wizard to find tokens by symbol or address.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDebounce } from 'use-debounce';
import type { EvmChainSlug } from '@/config/chains';
import { getChainId } from '@/config/chains';
import { apiClient } from '@/lib/api-client';

/**
 * Token search result
 * This matches the TokenSearchCandidate type from @midcurve/api-shared
 */
export interface TokenSearchResult {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  marketCap?: number;
}

/**
 * Options for useTokenSearch hook
 */
export interface UseTokenSearchOptions {
  chain: EvmChainSlug;
  type?: 'base' | 'quote'; // For future filtering if needed
  enabled?: boolean;
  debounceMs?: number;
}

/**
 * Return type for useTokenSearch hook
 */
export interface UseTokenSearchReturn {
  // Search state
  query: string;
  setQuery: (query: string) => void;
  debouncedQuery: string;

  // Results
  results: TokenSearchResult[];
  isLoading: boolean;
  error: string | null;

  // Actions
  search: (searchQuery: string) => Promise<void>;
  clearResults: () => void;

  // State
  hasSearched: boolean;
  isEmpty: boolean;
}

/**
 * Hook for searching tokens with debouncing
 *
 * @example
 * ```tsx
 * const tokenSearch = useTokenSearch({ chain: 'ethereum' });
 *
 * <input
 *   value={tokenSearch.query}
 *   onChange={(e) => tokenSearch.setQuery(e.target.value)}
 * />
 * ```
 */
export function useTokenSearch({
  chain,
  type,
  enabled = true,
  debounceMs = 300,
}: UseTokenSearchOptions): UseTokenSearchReturn {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TokenSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Debounce the search query
  const [debouncedQuery] = useDebounce(query, debounceMs);

  // Memoized search function
  const search = useCallback(
    async (searchQuery: string) => {
      if (!enabled) return;

      setIsLoading(true);
      setError(null);

      try {
        const chainId = getChainId(chain);

        // Detect if query is an Ethereum address and route to the appropriate endpoint
        const isAddressQuery = /^0x[0-9a-fA-F]{40}$/.test(searchQuery);

        let response;
        if (isAddressQuery) {
          const params = new URLSearchParams({
            address: searchQuery,
            chainIds: chainId.toString(),
          });
          response = await apiClient.get<any[]>(
            `/api/v1/tokens/erc20/search-by-address?${params.toString()}`
          );
        } else {
          const params = new URLSearchParams({
            chainIds: chainId.toString(),
            query: searchQuery,
          });
          if (type) {
            params.append('type', type);
          }
          response = await apiClient.get<any[]>(
            `/api/v1/tokens/erc20/search?${params.toString()}`
          );
        }

        // API returns { data: TokenSearchCandidate[] }
        // TokenSearchCandidate has: coingeckoId, symbol, name, address, chainId, logoUrl, marketCap
        const tokens = response.data || [];

        // Map to TokenSearchResult format
        // API returns TokenSymbolResult with addresses[] array grouped by symbol
        const chainId_ = getChainId(chain);
        const mappedTokens: TokenSearchResult[] = tokens
          .map((token: any) => {
            const chainAddress = token.addresses?.find(
              (a: any) => a.chainId === chainId_
            );
            return {
              address: chainAddress?.address || '',
              symbol: token.symbol,
              name: token.name,
              decimals: 18, // Default - will be resolved when token is created
              logoUrl: token.logoUrl || undefined,
              marketCap: token.marketCap || undefined,
            };
          })
          .filter((t: TokenSearchResult) => t.address !== '');

        // Sort by market cap (descending) - highest market cap first
        // Results from CoinGecko are already sorted by mcap, but DB results may not be
        const sortedTokens = mappedTokens.sort((a, b) => {
          const mcapA = a.marketCap ?? 0;
          const mcapB = b.marketCap ?? 0;
          return mcapB - mcapA; // Descending order
        });

        setResults(sortedTokens);
        setHasSearched(true);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Search failed';
        setError(errorMessage);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [chain, type, enabled]
  );

  // Search when debounced query changes and is long enough
  useEffect(() => {
    if (enabled && debouncedQuery !== undefined && debouncedQuery.length >= 2) {
      search(debouncedQuery);
    } else if (debouncedQuery.length === 0) {
      // Clear results when query is cleared
      setResults([]);
      setHasSearched(false);
    }
  }, [debouncedQuery, search, enabled]);

  // Clear results
  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
    setHasSearched(false);
    setQuery('');
  }, []);

  // Computed properties
  const isEmpty = useMemo(() => {
    return hasSearched && results.length === 0 && !isLoading;
  }, [hasSearched, results.length, isLoading]);

  return {
    // Search state
    query,
    setQuery,
    debouncedQuery,

    // Results
    results,
    isLoading,
    error,

    // Actions
    search,
    clearResults,

    // State
    hasSearched,
    isEmpty,
  };
}
