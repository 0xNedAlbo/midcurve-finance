/**
 * useSharedContract - Fetch shared automation contract for a chain
 *
 * Fetches the pre-deployed shared UniswapV3 automation contract
 * configuration for a specific chain.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, automationApi } from '@/lib/api-client';
import type { SharedContractInfo } from '@midcurve/api-shared';

interface UseSharedContractResult {
  /**
   * Shared contract info for the chain
   */
  contract: SharedContractInfo | null;

  /**
   * Whether the chain has a shared contract configured
   */
  isSupported: boolean;

  /**
   * Contract address (if available)
   */
  contractAddress: string | null;

  /**
   * Position manager (NFPM) address for this chain
   */
  positionManager: string | null;
}

/**
 * Hook to fetch shared contract for a chain
 */
export function useSharedContract(
  chainId: number | undefined,
  options?: Omit<UseQueryOptions<UseSharedContractResult>, 'queryKey' | 'queryFn' | 'enabled'>
) {
  return useQuery({
    queryKey: queryKeys.automation.sharedContracts.byChain(chainId ?? 0),
    queryFn: async (): Promise<UseSharedContractResult> => {
      if (!chainId) {
        return { contract: null, isSupported: false, contractAddress: null, positionManager: null };
      }

      try {
        const response = await automationApi.getSharedContract(chainId);
        const contract = response.data;

        return {
          contract,
          isSupported: true,
          contractAddress: contract.contractAddress,
          positionManager: contract.positionManager,
        };
      } catch (error) {
        // 404 means chain is not supported - this is expected
        if (error instanceof ApiError && error.statusCode === 404) {
          return { contract: null, isSupported: false, contractAddress: null, positionManager: null };
        }
        throw error;
      }
    },
    enabled: !!chainId,
    staleTime: 5 * 60 * 1000, // 5 minutes - shared contracts rarely change
    ...options,
  });
}
