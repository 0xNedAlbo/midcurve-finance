/**
 * React Query Hook for Uniswap V3 Position Ledger
 *
 * Fetches the complete history of ledger events for a Uniswap V3 position,
 * including liquidity changes and fee collections.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LedgerEventData } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';

/**
 * Fetch ledger events for a Uniswap V3 position
 *
 * @param chainId - The EVM chain ID
 * @param nftId - The NFT Position Manager token ID
 * @returns React Query result with ledger events array
 *
 * NOTE: apiClient automatically extracts the 'data' field from the response,
 * so this hook returns LedgerEventData[] directly (not LedgerEventsResponse)
 */
export function useUniswapV3Ledger(
  chainId: number,
  nftId: string
): UseQueryResult<LedgerEventData[], Error> {
  return useQuery<LedgerEventData[], Error>({
    queryKey: ['uniswapv3-ledger', chainId, nftId],
    queryFn: async () => {
      // apiClient extracts response.data automatically
      return apiClient<LedgerEventData[]>(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}/ledger`
      );
    },
    staleTime: 60 * 1000, // 1 minute
    gcTime: 60 * 1000, // 1 minute (renamed from cacheTime in React Query v5)
  });
}
