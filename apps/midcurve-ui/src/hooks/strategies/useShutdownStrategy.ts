/**
 * useShutdownStrategy - Shutdown a running strategy
 *
 * Mutation hook for shutting down a strategy that's in "active" state.
 * Calls the API which proxies to the EVM service to initiate the shutdown lifecycle.
 *
 * After receiving a 202 response (operation started), this hook polls for
 * completion until the operation succeeds or fails. This ensures the UI
 * shows proper error messages if the background operation fails.
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
  operationStatus: 'pending' | 'publishing_event' | 'waiting_for_transition' | 'stopping_loop' | 'teardown_topology' | 'completed' | 'failed';
  operationStartedAt?: string;
  operationCompletedAt?: string;
  operationError?: string;
  pollUrl: string;
}

interface OperationStatusResponse {
  contractAddress: string;
  operation: string;
  operationStatus: string;
  operationStartedAt?: string;
  operationCompletedAt?: string;
  operationError?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the dedicated operation endpoint until the operation completes or fails.
 * The endpoint returns only operation status (not mixed with strategy status).
 */
async function pollForCompletion(
  pollUrl: string,
  contractAddress: string,
  maxAttempts = 60,
  intervalMs = 1000
): Promise<ShutdownStrategyResponse> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);

    let response: OperationStatusResponse;
    try {
      response = await apiClientFn<OperationStatusResponse>(pollUrl, {
        method: 'GET',
      });
    } catch (error) {
      if (error instanceof ApiError) {
        // 404 means no operation found - might have completed before we could poll
        if (error.statusCode === 404) {
          throw new ApiError(
            'Shutdown operation not found - it may have failed before polling started',
            500
          );
        }
        throw error;
      }
      throw error;
    }

    // Check operation status (the dedicated endpoint always returns this)
    if (response.operationStatus === 'completed') {
      return {
        contractAddress,
        operation: 'shutdown',
        operationStatus: 'completed',
        operationStartedAt: response.operationStartedAt,
        operationCompletedAt: response.operationCompletedAt,
        pollUrl,
      };
    }

    if (response.operationStatus === 'failed') {
      throw new ApiError(response.operationError || 'Shutdown operation failed', 500);
    }

    // Still in progress, continue polling
  }

  throw new ApiError('Shutdown operation timed out', 408);
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
      // Initial request - starts the operation
      const response = await apiClientFn<ShutdownStrategyResponse>(
        '/api/v1/strategies/lifecycle/shutdown',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        }
      );

      // If already completed, return immediately
      if (response.operationStatus === 'completed') {
        return response;
      }

      // If already failed, throw error
      if (response.operationStatus === 'failed') {
        throw new ApiError(response.operationError || 'Shutdown operation failed', 500);
      }

      // Operation in progress - poll until complete or failed
      return pollForCompletion(
        response.pollUrl,
        params.contractAddress
      );
    },

    onSuccess: () => {
      // Invalidate strategy-related queries to refresh after shutdown
      queryClient.invalidateQueries({
        queryKey: queryKeys.strategies.all,
      });
    },
  });
}
