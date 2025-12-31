/**
 * useDeployStrategy - Deploy a strategy from a manifest
 *
 * Mutation hook for deploying a new strategy instance.
 * Calls the signer service to deploy the contract and create an automation wallet.
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, apiClientFn } from '@/lib/api-client';
import type {
  DeployStrategyRequest,
  DeployStrategyResponse,
} from '@midcurve/api-shared';

export function useDeployStrategy(
  options?: Omit<
    UseMutationOptions<
      DeployStrategyResponse,
      ApiError,
      DeployStrategyRequest,
      unknown
    >,
    'mutationFn' | 'onSuccess'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    ...options,

    mutationFn: async (request: DeployStrategyRequest) => {
      // Session validation happens automatically on the server via cookies
      return apiClientFn<DeployStrategyResponse>('/api/v1/strategies/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
    },

    onSuccess: () => {
      // Invalidate strategy-related queries to refresh after deployment
      queryClient.invalidateQueries({
        queryKey: queryKeys.strategies.all,
      });
    },
  });
}
