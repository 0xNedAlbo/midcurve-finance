/**
 * useErc20TokenBalance Hook
 *
 * React Query hook for fetching ERC-20 token balances via the backend API.
 * Polls the API at regular intervals and supports manual refetch for immediate updates.
 *
 * Features:
 * - Fetches balance via backend API (uses reliable RPC infrastructure)
 * - Auto-refresh every 5 seconds
 * - Manual refetch for immediate updates after user actions
 * - Shared query cache across components
 *
 * @example
 * ```typescript
 * const { balanceBigInt, isLoading, error, refetch } = useErc20TokenBalance({
 *   walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
 *   tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
 *   chainId: 1,
 * });
 *
 * if (isLoading) return <Loader />;
 * if (error) return <Error message={error} />;
 *
 * return (
 *   <div>
 *     Balance: {formatUnits(balanceBigInt, 18)} WETH
 *     <button onClick={refetch}>Refresh</button>
 *   </div>
 * );
 * ```
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import type { TokenBalanceData } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';

/**
 * Options for useErc20TokenBalance hook
 */
export interface UseErc20TokenBalanceOptions {
  /**
   * Wallet address to check balance for
   * Example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
   *
   * Set to null to disable fetching and event watching
   */
  walletAddress: string | null;

  /**
   * ERC-20 token contract address
   * Example: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" (WETH)
   *
   * Set to null to disable fetching and event watching
   */
  tokenAddress: string | null;

  /**
   * EVM chain ID
   * Example: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * Whether the query and event watching are enabled (default: true)
   * Set to false to prevent automatic fetching and event watching
   */
  enabled?: boolean;
}

/**
 * Return value from useErc20TokenBalance hook
 */
export interface UseErc20TokenBalanceReturn {
  /**
   * Token balance data from API (undefined while loading)
   */
  balance: TokenBalanceData | undefined;

  /**
   * Balance as BigInt (parsed from string)
   * Undefined if no data yet
   */
  balanceBigInt: bigint | undefined;

  /**
   * Whether the query is currently loading (first fetch)
   */
  isLoading: boolean;

  /**
   * Whether the query is fetching (includes refetches)
   */
  isFetching: boolean;

  /**
   * Whether the query encountered an error
   */
  isError: boolean;

  /**
   * Error message if query failed
   */
  error: string | null;

  /**
   * Manually refetch balance from API
   * Useful after user sends transaction to force immediate update
   */
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch ERC-20 token balance via backend API
 *
 * Uses TanStack Query for data fetching with automatic polling.
 * Multiple components watching the same token will share the same cached data.
 *
 * **Architecture:**
 * - Polls backend API every 5 seconds for balance updates
 * - Backend uses reliable RPC infrastructure (no public rate limits)
 * - Call `refetch()` for immediate updates after user actions (swaps, approvals)
 *
 * @param options - Configuration options
 * @returns Balance data and query state
 */
export function useErc20TokenBalance(
  options: UseErc20TokenBalanceOptions
): UseErc20TokenBalanceReturn {
  const { walletAddress, tokenAddress, chainId, enabled = true } = options;

  // TanStack Query key for caching
  const queryKey = [
    'erc20-token-balance',
    chainId,
    tokenAddress,
    walletAddress,
  ];

  // Fetch balance from backend API
  const queryFn = async (): Promise<TokenBalanceData> => {
    if (!walletAddress || !tokenAddress) {
      throw new Error('Wallet address and token address are required');
    }

    const params = new URLSearchParams({
      walletAddress,
      tokenAddress,
      chainId: chainId.toString(),
    });

    const response = await apiClient.get<TokenBalanceData>(
      `/api/v1/tokens/erc20/balance?${params.toString()}`
    );

    return response.data;
  };

  // Set up TanStack Query
  const query = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!walletAddress && !!tokenAddress,
    staleTime: 5 * 1000, // Consider data fresh for 5 seconds
    refetchInterval: 5 * 1000, // Auto-refetch every 5 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: (failureCount, error) => {
      // Don't retry validation errors (4xx)
      const errorMessage = error?.message || '';
      if (
        errorMessage.includes('Invalid') ||
        errorMessage.includes('400') ||
        errorMessage.includes('404')
      ) {
        return false;
      }

      // Retry network errors and 502/503 up to 2 times
      return failureCount < 2;
    },
  });

  // Parse balance string to BigInt
  const balanceBigInt = query.data?.balance
    ? BigInt(query.data.balance)
    : undefined;

  return {
    balance: query.data,
    balanceBigInt,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error?.message || null,
    refetch: async () => {
      await query.refetch();
    },
  };
}
