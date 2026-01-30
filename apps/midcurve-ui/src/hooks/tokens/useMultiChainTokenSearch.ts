/**
 * Multi-Chain Token Search Hook
 *
 * Hook for searching tokens across multiple chains with debouncing.
 * Used in the pool selection wizard to find tokens by symbol.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDebounce } from 'use-debounce';
import { apiClient } from '@/lib/api-client';

/**
 * Token search result - simplified version for display
 */
export interface TokenSearchResult {
  symbol: string;
  name: string;
  logoUrl?: string;
  marketCap?: number;
  coingeckoId?: string;
  // Addresses on the searched chains
  addresses: Array<{
    chainId: number;
    address: string;
  }>;
}

/**
 * Options for useMultiChainTokenSearch hook
 */
export interface UseMultiChainTokenSearchOptions {
  chainIds: number[];
  enabled?: boolean;
  debounceMs?: number;
}

/**
 * Return type for useMultiChainTokenSearch hook
 */
export interface UseMultiChainTokenSearchReturn {
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
 * Hook for searching tokens across multiple chains with debouncing
 *
 * @example
 * ```tsx
 * const tokenSearch = useMultiChainTokenSearch({ chainIds: [1, 42161, 8453] });
 *
 * <input
 *   value={tokenSearch.query}
 *   onChange={(e) => tokenSearch.setQuery(e.target.value)}
 * />
 * ```
 */
export function useMultiChainTokenSearch({
  chainIds,
  enabled = true,
  debounceMs = 300,
}: UseMultiChainTokenSearchOptions): UseMultiChainTokenSearchReturn {
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
      if (!enabled || chainIds.length === 0) return;

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          chainIds: chainIds.join(','),
          query: searchQuery,
        });

        const response = await apiClient.get<TokenSearchResult[]>(
          `/api/v1/tokens/erc20/search?${params.toString()}`
        );

        // API returns TokenSymbolResult[] with: symbol, name, coingeckoId, logoUrl, marketCap, addresses[]
        const tokens = response.data || [];

        // Results are already sorted by market cap from the API
        setResults(tokens);
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
    [chainIds, enabled]
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
