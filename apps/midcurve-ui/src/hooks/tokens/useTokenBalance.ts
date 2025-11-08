/**
 * useTokenBalance Hook
 *
 * React Query hook for fetching ERC-20 token balances with real-time event watching.
 * Uses wagmi's useWatchContractEvent to listen for Transfer events and update balances instantly.
 *
 * Features:
 * - Watches ERC-20 Transfer events in real-time
 * - Uses wallet provider's RPC (no backend RPC URLs exposed)
 * - Instantly refetches balance when transfer detected
 * - No polling overhead
 * - Filters events by wallet address and token address
 */

import { useQuery } from '@tanstack/react-query';
import { useWatchContractEvent } from 'wagmi';
import type { TokenBalanceData } from '@midcurve/api-shared';

// ERC-20 Transfer event ABI
const TRANSFER_EVENT_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
  },
] as const;

export interface UseTokenBalanceOptions {
  /**
   * Wallet address to check balance for
   * Example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
   */
  walletAddress: string | null;

  /**
   * ERC-20 token contract address
   * Example: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" (WETH)
   */
  tokenAddress: string | null;

  /**
   * EVM chain ID
   * Example: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * Whether the query is enabled (default: true)
   * Set to false to prevent automatic fetching and event watching
   */
  enabled?: boolean;
}

export interface UseTokenBalanceReturn {
  /**
   * Token balance data (undefined while loading)
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
   * Manually refetch balance
   * Useful after transactions to force immediate update
   */
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch ERC-20 token balance with real-time Transfer event watching
 *
 * @example
 * ```typescript
 * const { balanceBigInt, isLoading, error } = useTokenBalance({
 *   walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
 *   tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
 *   chainId: 1,
 * });
 *
 * if (isLoading) return <Loader />;
 * if (error) return <Error message={error} />;
 *
 * return <div>Balance: {formatUnits(balanceBigInt, 18)} WETH</div>;
 * ```
 */
export function useTokenBalance(
  options: UseTokenBalanceOptions
): UseTokenBalanceReturn {
  const { walletAddress, tokenAddress, chainId, enabled = true } = options;

  const queryKey = [
    'token-balance',
    chainId,
    tokenAddress,
    walletAddress,
  ];

  const queryFn = async (): Promise<TokenBalanceData> => {
    if (!walletAddress || !tokenAddress) {
      throw new Error('Wallet address and token address are required');
    }

    const params = new URLSearchParams({
      walletAddress,
      tokenAddress,
      chainId: chainId.toString(),
    });

    const response = await fetch(
      `/api/v1/tokens/erc20/balance?${params.toString()}`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage =
        errorData?.error?.message ||
        errorData?.error ||
        `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage);
    }

    const data = await response.json();

    // API returns ApiResponse<TokenBalanceData>
    // Extract the data field
    return data.data;
  };

  const query = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!walletAddress && !!tokenAddress,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
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

  // Watch for Transfer events involving this wallet and token
  // This uses the wallet provider's RPC (no backend RPC URLs exposed)
  useWatchContractEvent({
    address: tokenAddress as `0x${string}` | undefined,
    abi: TRANSFER_EVENT_ABI,
    eventName: 'Transfer',
    chainId,
    enabled: enabled && !!walletAddress && !!tokenAddress,
    onLogs: (logs) => {
      // Check if any Transfer event involves our wallet (as sender or receiver)
      const walletAddressLower = walletAddress?.toLowerCase();

      const relevantTransfer = logs.some((log) => {
        const from = log.args.from?.toLowerCase();
        const to = log.args.to?.toLowerCase();

        return from === walletAddressLower || to === walletAddressLower;
      });

      // If a relevant transfer was detected, refetch balance immediately
      if (relevantTransfer) {
        console.log('[useTokenBalance] Transfer event detected, refetching balance...');
        query.refetch();
      }
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
