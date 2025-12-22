/**
 * useStartStrategy - Start a deployed strategy
 *
 * Mutation hook for starting a strategy that's in "deployed" state.
 * Calls the API which proxies to the EVM service to initiate the start lifecycle.
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, apiClientFn } from '@/lib/api-client';

interface StartStrategyParams {
  contractAddress: string;
}

interface StartStrategyResponse {
  contractAddress: string;
  operation: 'start';
  status: 'pending' | 'starting_loop' | 'publishing_event' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  pollUrl: string;
}

export function useStartStrategy(
  options?: Omit<
    UseMutationOptions<
      StartStrategyResponse,
      ApiError,
      StartStrategyParams,
      unknown
    >,
    'mutationFn' | 'onSuccess'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    ...options,

    mutationFn: async (params: StartStrategyParams) => {
      return apiClientFn<StartStrategyResponse>('/api/v1/strategies/lifecycle/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    },

    onSuccess: () => {
      // Invalidate strategy-related queries to refresh after starting
      queryClient.invalidateQueries({
        queryKey: queryKeys.strategies.all,
      });
    },
  });
}
