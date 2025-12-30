/**
 * usePrepareVaultDeployment - Fetch vault deployment parameters
 *
 * Query hook to get all parameters needed to deploy a vault contract.
 * Should be called after strategy deployment is complete.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, apiClientFn } from '@/lib/api-client';
import type { PrepareVaultDeploymentData } from '@midcurve/api-shared';

export function usePrepareVaultDeployment(
  strategyId: string | undefined,
  options?: Omit<
    UseQueryOptions<PrepareVaultDeploymentData, ApiError>,
    'queryKey' | 'queryFn'
  >
) {
  return useQuery({
    ...options,
    queryKey: queryKeys.strategies.vault.prepare(strategyId || ''),
    queryFn: async () => {
      if (!strategyId) {
        throw new Error('Strategy ID is required');
      }
      return apiClientFn<PrepareVaultDeploymentData>(
        `/api/v1/strategies/${strategyId}/vault/prepare`
      );
    },
    enabled: !!strategyId && (options?.enabled ?? true),
  });
}
