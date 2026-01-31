/**
 * Multi-Chain Token Search Hook
 *
 * Hook for searching tokens across multiple chains with debouncing.
 * Used in the pool selection wizard to find tokens by symbol or address.
 *
 * Supports:
 * - Symbol search: Partial match on token symbol (e.g., "WETH", "USD")
 * - Address search: Exact match on token contract address (e.g., "0x...")
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDebounce } from 'use-debounce';
import { apiClient } from '@/lib/api-client';

/**
 * Check if a string is a valid Ethereum address format
 */
function isEthereumAddress(query: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(query);
}

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
        let tokens: TokenSearchResult[];

        if (isEthereumAddress(searchQuery)) {
          // Address-based search
          const params = new URLSearchParams({
            address: searchQuery,
            chainIds: chainIds.join(','),
          });

          const response = await apiClient.get<TokenSearchResult[]>(
            `/api/v1/tokens/erc20/search-by-address?${params.toString()}`
          );

          tokens = response.data || [];
        } else {
          // Symbol-based search
          const params = new URLSearchParams({
            chainIds: chainIds.join(','),
            query: searchQuery,
          });

          const response = await apiClient.get<TokenSearchResult[]>(
            `/api/v1/tokens/erc20/search?${params.toString()}`
          );

          tokens = response.data || [];
        }

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
    if (!enabled) return;

    if (debouncedQuery.length === 0) {
      // Clear results when query is cleared
      setResults([]);
      setHasSearched(false);
      return;
    }

    // For addresses: only search when complete (42 chars: 0x + 40 hex)
    // For symbols: search when >= 2 chars
    const isAddress = debouncedQuery.startsWith('0x');
    const shouldSearch = isAddress
      ? isEthereumAddress(debouncedQuery)
      : debouncedQuery.length >= 2;

    if (shouldSearch) {
      search(debouncedQuery);
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
