/**
 * useStartStrategy - Start a deployed strategy
 *
 * Mutation hook for starting a strategy that's in "deployed" state.
 * Calls the API which proxies to the EVM service to initiate the start lifecycle.
 *
 * After receiving a 202 response (operation started), this hook polls for
 * completion until the operation succeeds or fails. This ensures the UI
 * shows proper error messages if the background operation fails.
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
  operationStatus: 'pending' | 'starting_loop' | 'publishing_event' | 'completed' | 'failed';
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
  maxAttempts = 30,
  intervalMs = 1000
): Promise<StartStrategyResponse> {
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
          // Check if this is because the operation completed
          // The endpoint returns 404 only if no operation AND strategy not active
          throw new ApiError(
            'Start operation not found - it may have failed before polling started',
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
        operation: 'start',
        operationStatus: 'completed',
        operationStartedAt: response.operationStartedAt,
        operationCompletedAt: response.operationCompletedAt,
        pollUrl,
      };
    }

    if (response.operationStatus === 'failed') {
      throw new ApiError(response.operationError || 'Start operation failed', 500);
    }

    // Still in progress, continue polling
  }

  throw new ApiError('Start operation timed out', 408);
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
      // Initial request - starts the operation
      const response = await apiClientFn<StartStrategyResponse>(
        '/api/v1/strategies/lifecycle/start',
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
        throw new ApiError(response.operationError || 'Start operation failed', 500);
      }

      // Operation in progress - poll until complete or failed
      return pollForCompletion(
        response.pollUrl,
        params.contractAddress
      );
    },

    onSuccess: () => {
      // Invalidate strategy-related queries to refresh after starting
      queryClient.invalidateQueries({
        queryKey: queryKeys.strategies.all,
      });
    },
  });
}
