/**
 * useOpenHedgeBackend Hook
 *
 * Mutation hook for opening a Hyperliquid hedge via the backend API.
 * All signing happens on the backend using the user's stored API wallet.
 *
 * This replaces the client-side signing flow (useOpenHyperliquidHedge)
 * with a single API call that handles all steps:
 * 1. Prepare subaccount
 * 2. Transfer margin
 * 3. Place order
 * 4. Monitor fill
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  OpenHyperliquidHedgeRequest,
  OpenHyperliquidHedgeResponse,
  ApiError,
} from '@midcurve/api-shared';

interface UseOpenHedgeBackendOptions {
  onSuccess?: (data: OpenHyperliquidHedgeResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for opening a Hyperliquid hedge via backend API
 *
 * @example
 * ```tsx
 * const openHedge = useOpenHedgeBackend({
 *   onSuccess: (data) => console.log('Hedge opened:', data),
 *   onError: (error) => console.error('Failed:', error),
 * });
 *
 * // Trigger the mutation
 * openHedge.mutate({
 *   positionHash: 'uniswapv3/8453/123456',
 *   leverage: 3,
 *   biasPercent: 0,
 *   marginMode: 'isolated',
 *   coin: 'ETH',
 *   hedgeSize: '1.5',
 *   notionalValueUsd: '5000.00',
 *   markPrice: '3200.50',
 * });
 * ```
 */
export function useOpenHedgeBackend(options: UseOpenHedgeBackendOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: OpenHyperliquidHedgeRequest
    ): Promise<OpenHyperliquidHedgeResponse> => {
      const response = await fetch('/api/v1/hedges/hyperliquid/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok) {
        // Extract error details from API error response
        const apiError = data as ApiError;
        const errorMessage =
          apiError.error?.message || 'Failed to open hedge';
        const errorCode =
          (apiError.error?.details as { code?: string })?.code || 'UNKNOWN';

        const error = new Error(errorMessage);
        (error as Error & { code?: string }).code = errorCode;
        throw error;
      }

      return data.data as OpenHyperliquidHedgeResponse;
    },
    onSuccess: (data) => {
      // Invalidate relevant queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['hyperliquid-subaccounts'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });

      options.onSuccess?.(data);
    },
    onError: (error: Error) => {
      options.onError?.(error);
    },
  });
}

/**
 * Type for the mutation result with error code
 */
export type OpenHedgeError = Error & { code?: string };
