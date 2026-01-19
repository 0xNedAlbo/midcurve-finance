/**
 * Swap Quote Hook
 *
 * Fetches swap quotes from ParaSwap with automatic refresh.
 * Tracks quote expiration and provides countdown functionality.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { swapApi, type SwapQuoteParams } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { SwapQuoteData } from '@midcurve/api-shared';

export interface UseSwapQuoteParams {
  chainId: number | undefined;
  srcToken: string | undefined;
  srcDecimals: number | undefined;
  destToken: string | undefined;
  destDecimals: number | undefined;
  amount: string | undefined;
  userAddress: string | undefined;
  /** SELL (default) = fixed input, BUY = fixed output */
  side?: 'SELL' | 'BUY';
  slippageBps?: number;
  enabled?: boolean;
  autoRefresh?: boolean;
  refetchInterval?: number;
}

export interface UseSwapQuoteResult {
  quote: SwapQuoteData | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;

  // Quote expiration
  isExpired: boolean;
  expiresAt: Date | null;
  secondsUntilExpiry: number | null;

  // Actions
  refetch: () => void;
  refreshQuote: () => void;
}

/**
 * Hook to fetch swap quotes from ParaSwap
 *
 * Features:
 * - Auto-refresh every 15 seconds (configurable)
 * - Quote expiration tracking with countdown
 * - Pauses auto-refresh when quote is being reviewed
 */
export function useSwapQuote({
  chainId,
  srcToken,
  srcDecimals,
  destToken,
  destDecimals,
  amount,
  userAddress,
  side,
  slippageBps,
  enabled = true,
  autoRefresh = true,
  refetchInterval = 15000, // 15 seconds
}: UseSwapQuoteParams): UseSwapQuoteResult {
  const [now, setNow] = useState(Date.now());

  // Check if all required params are present
  const hasAllParams =
    chainId !== undefined &&
    srcToken !== undefined &&
    srcDecimals !== undefined &&
    destToken !== undefined &&
    destDecimals !== undefined &&
    amount !== undefined &&
    amount !== '0' &&
    userAddress !== undefined;

  // Query params for cache key
  const queryParams = useMemo(
    () => ({
      chainId: chainId ?? 0,
      srcToken: srcToken ?? '',
      destToken: destToken ?? '',
      amount: amount ?? '',
      userAddress: userAddress ?? '',
      side: side ?? 'SELL',
    }),
    [chainId, srcToken, destToken, amount, userAddress, side]
  );

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.swap.quotes.quote(queryParams),
    queryFn: async () => {
      if (!hasAllParams) throw new Error('Missing required params');

      const params: SwapQuoteParams = {
        chainId: chainId!,
        srcToken: srcToken!,
        srcDecimals: srcDecimals!,
        destToken: destToken!,
        destDecimals: destDecimals!,
        amount: amount!,
        userAddress: userAddress!,
        side,
        slippageBps,
      };

      const response = await swapApi.getQuote(params);
      return response.data;
    },
    enabled: enabled && hasAllParams,
    staleTime: 10000, // 10 seconds
    refetchInterval: autoRefresh ? refetchInterval : false,
  });

  // Update "now" every second for countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Parse expiration
  const expiresAt = useMemo(() => {
    if (!data?.expiresAt) return null;
    return new Date(data.expiresAt);
  }, [data?.expiresAt]);

  // Calculate expiration state
  const isExpired = useMemo(() => {
    if (!expiresAt) return false;
    return now > expiresAt.getTime();
  }, [expiresAt, now]);

  const secondsUntilExpiry = useMemo(() => {
    if (!expiresAt) return null;
    const remaining = Math.floor((expiresAt.getTime() - now) / 1000);
    return Math.max(0, remaining);
  }, [expiresAt, now]);

  // Manual refresh function
  const refreshQuote = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    quote: data ?? null,
    isLoading,
    isFetching,
    isError,
    error: error as Error | null,

    // Expiration
    isExpired,
    expiresAt,
    secondsUntilExpiry,

    // Actions
    refetch,
    refreshQuote,
  };
}
