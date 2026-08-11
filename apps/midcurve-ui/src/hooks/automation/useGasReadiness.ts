/**
 * useGasReadiness — can this chain's automation pay to execute a close order?
 *
 * Consulted by every close-order registration flow. The answer is one of four
 * states, and the gate renders the missing steps for whichever applies.
 *
 * All chain reads happen on the backend. Nothing here touches an RPC.
 */

import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { GasReadinessData } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface UseGasReadinessResult {
  readiness: GasReadinessData | null;
  isLoading: boolean;
  /**
   * The readiness read failed.
   *
   * The gate fails open on this: registration is never blocked by a failed
   * readiness read. Blocking would be a worse outcome than the decline the
   * flow already permits.
   */
  error: Error | null;
  refetch: () => void;
}

/**
 * @param chainId - Chain the position lives on
 * @param walletAddress - Connected wallet, so the funding step can explain
 *                        itself when the wallet cannot afford the transfer
 */
export function useGasReadiness(
  chainId: number | undefined,
  walletAddress: string | undefined,
  options?: Omit<
    UseQueryOptions<GasReadinessData>,
    'queryKey' | 'queryFn' | 'enabled'
  >,
): UseGasReadinessResult {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.automation.gasReadiness.byChain(
    chainId ?? 0,
    walletAddress,
  );

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<GasReadinessData> => {
      const params = walletAddress ? `?walletAddress=${walletAddress}` : '';
      const response = await apiClient.get<GasReadinessData>(
        `/api/v1/automation/gas-readiness/${chainId}${params}`,
      );
      return response.data;
    },
    enabled: !!chainId,
    // Short: the operator balance moves whenever an order executes, and the
    // gate is re-read after each of its own transactions.
    staleTime: 15_000,
    ...options,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    readiness: data ?? null,
    isLoading,
    error: (error as Error) ?? null,
    refetch,
  };
}
