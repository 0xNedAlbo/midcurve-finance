/**
 * useAutomationContract - Check if user has automation contract on chain
 *
 * Fetches the user's UniswapV3 automation contract for a specific chain.
 * Returns null if no contract exists (not yet deployed).
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, automationApi } from '@/lib/api-client';
import type { SerializedAutomationContract } from '@midcurve/api-shared';

interface UseAutomationContractResult {
  /**
   * The automation contract, or null if not deployed
   */
  contract: SerializedAutomationContract | null;

  /**
   * Whether the user has a deployed contract
   */
  hasContract: boolean;

  /**
   * Contract address (if deployed)
   */
  contractAddress: string | null;
}

/**
 * Hook to fetch automation contract for a chain
 */
export function useAutomationContract(
  chainId: number | undefined,
  options?: Omit<UseQueryOptions<UseAutomationContractResult>, 'queryKey' | 'queryFn' | 'enabled'>
) {
  return useQuery({
    queryKey: queryKeys.automation.contracts.byChain(chainId ?? 0),
    queryFn: async (): Promise<UseAutomationContractResult> => {
      if (!chainId) {
        return { contract: null, hasContract: false, contractAddress: null };
      }

      try {
        const response = await automationApi.getContractByChain(chainId, 'uniswapv3');
        const contract = response.data;

        // Check if contract is deployed (has contractAddress in config)
        const config = contract.config as { contractAddress?: string };
        const contractAddress = config.contractAddress ?? null;

        return {
          contract,
          hasContract: !!contractAddress,
          contractAddress,
        };
      } catch (error) {
        // 404 means no contract exists yet - this is expected
        if (error instanceof ApiError && error.statusCode === 404) {
          return { contract: null, hasContract: false, contractAddress: null };
        }
        throw error;
      }
    },
    enabled: !!chainId,
    staleTime: 60_000, // 1 minute
    ...options,
  });
}

/**
 * Hook to list all automation contracts for the user
 */
export function useAutomationContracts(
  options?: Omit<UseQueryOptions<SerializedAutomationContract[]>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.automation.contracts.lists(),
    queryFn: async () => {
      const response = await automationApi.listContracts();
      return response.data;
    },
    staleTime: 60_000, // 1 minute
    ...options,
  });
}
