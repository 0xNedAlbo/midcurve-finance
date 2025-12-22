/**
 * useShutdownStrategy - Shutdown a running strategy
 *
 * Mutation hook for shutting down a strategy that's in "active" state.
 * Calls the API which proxies to the EVM service to initiate the shutdown lifecycle.
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, apiClientFn } from '@/lib/api-client';

interface ShutdownStrategyParams {
  contractAddress: string;
}

interface ShutdownStrategyResponse {
  contractAddress: string;
  operation: 'shutdown';
  status: 'pending' | 'publishing_event' | 'waiting_for_transition' | 'stopping_loop' | 'teardown_topology' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  pollUrl: string;
}

export function useShutdownStrategy(
  options?: Omit<
    UseMutationOptions<
      ShutdownStrategyResponse,
      ApiError,
      ShutdownStrategyParams,
      unknown
    >,
    'mutationFn' | 'onSuccess'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    ...options,

    mutationFn: async (params: ShutdownStrategyParams) => {
      return apiClientFn<ShutdownStrategyResponse>('/api/v1/strategies/lifecycle/shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    },

    onSuccess: () => {
      // Invalidate strategy-related queries to refresh after shutdown
      queryClient.invalidateQueries({
        queryKey: queryKeys.strategies.all,
      });
    },
  });
}
