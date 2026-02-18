/**
 * Router Swap Quote Hook
 *
 * Fetches swap quotes from MidcurveSwapRouter with automatic refresh.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { swapRouterApi, type RouterSwapQuoteParams } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { RouterSwapQuoteData } from '@midcurve/api-shared';

export interface UseRouterSwapQuoteParams {
  chainId: number | undefined;
  tokenIn: string | undefined;
  tokenInDecimals: number | undefined;
  tokenOut: string | undefined;
  tokenOutDecimals: number | undefined;
  amountIn: string | undefined;
  maxDeviationBps: number;
  maxHops?: number;
  enabled?: boolean;
  autoRefresh?: boolean;
  refetchInterval?: number;
}

export interface UseRouterSwapQuoteResult {
  quote: RouterSwapQuoteData | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;

  // Actions
  refetch: () => void;
  refreshQuote: () => void;
}

/**
 * Hook to fetch swap quotes from MidcurveSwapRouter.
 *
 * Features:
 * - Auto-refresh every 15 seconds (configurable)
 * - Fair value price comparison
 * - Hop route information
 * - Deviation analysis
 */
export function useRouterSwapQuote({
  chainId,
  tokenIn,
  tokenInDecimals,
  tokenOut,
  tokenOutDecimals,
  amountIn,
  maxDeviationBps,
  maxHops,
  enabled = true,
  autoRefresh = true,
  refetchInterval = 15000,
}: UseRouterSwapQuoteParams): UseRouterSwapQuoteResult {
  const hasAllParams =
    chainId !== undefined &&
    tokenIn !== undefined &&
    tokenInDecimals !== undefined &&
    tokenOut !== undefined &&
    tokenOutDecimals !== undefined &&
    amountIn !== undefined &&
    amountIn !== '0';

  const queryParams = useMemo(
    () => ({
      chainId: chainId ?? 0,
      tokenIn: tokenIn ?? '',
      tokenOut: tokenOut ?? '',
      amountIn: amountIn ?? '',
      maxDeviationBps,
    }),
    [chainId, tokenIn, tokenOut, amountIn, maxDeviationBps]
  );

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.swap.routerQuotes.quote(queryParams),
    queryFn: async () => {
      if (!hasAllParams) throw new Error('Missing required params');

      const params: RouterSwapQuoteParams = {
        chainId: chainId!,
        tokenIn: tokenIn!,
        tokenInDecimals: tokenInDecimals!,
        tokenOut: tokenOut!,
        tokenOutDecimals: tokenOutDecimals!,
        amountIn: amountIn!,
        maxDeviationBps,
        maxHops,
      };

      const response = await swapRouterApi.getQuote(params);
      return response.data;
    },
    enabled: enabled && hasAllParams,
    staleTime: 10000,
    refetchInterval: autoRefresh ? refetchInterval : false,
  });

  const refreshQuote = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    quote: data ?? null,
    isLoading,
    isFetching,
    isError,
    error: error as Error | null,
    refetch,
    refreshQuote,
  };
}
