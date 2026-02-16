/**
 * Swap Router Supported Chains Hook
 *
 * Fetches the list of chains that have MidcurveSwapRouter deployed.
 * Used by SwapDialog to populate the chain selector dynamically.
 */

import { useQuery } from '@tanstack/react-query';
import { swapRouterApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { RouterSupportedChainsData } from '@midcurve/api-shared';

export interface UseSwapRouterSupportedChainsResult {
  data: RouterSupportedChainsData | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Hook to fetch chains with MidcurveSwapRouter deployed.
 * Chains rarely change, so staleTime is set to 5 minutes.
 */
export function useSwapRouterSupportedChains(): UseSwapRouterSupportedChainsResult {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.swap.routerSupportedChains,
    queryFn: async () => {
      const response = await swapRouterApi.getSupportedChains();
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    data: data ?? null,
    isLoading,
    isError,
    error: error as Error | null,
  };
}
