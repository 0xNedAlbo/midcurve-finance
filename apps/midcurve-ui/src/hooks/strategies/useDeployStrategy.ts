/**
 * useDeployStrategy - Deploy a strategy from a manifest
 *
 * Mutation hook for deploying a new strategy instance.
 * Calls the signer service to deploy the contract and create an automation wallet.
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError } from '@/lib/api-client';
import type {
  DeployStrategyRequest,
  DeployStrategyResponse,
} from '@midcurve/api-shared';
import { getSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

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
      // Verify session before making request
      const session = await getSession();
      if (!session?.user) {
        throw new ApiError(
          'Not authenticated. Please sign in first.',
          401,
          'UNAUTHENTICATED'
        );
      }

      const response = await fetch(`${API_BASE_URL}/api/v1/strategies/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(
          data.error?.message || 'Deployment failed',
          response.status,
          data.error?.code,
          data.error?.details
        );
      }

      // API returns { success, data: DeployStrategyResponse }
      return data.data as DeployStrategyResponse;
    },

    onSuccess: () => {
      // Invalidate strategy-related queries to refresh after deployment
      queryClient.invalidateQueries({
        queryKey: queryKeys.strategies.all,
      });
    },
  });
}
