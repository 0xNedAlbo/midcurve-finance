/**
 * Paraswap Quote Hook
 *
 * Fetches swap quotes from Paraswap with automatic refresh.
 * Tracks quote expiration and provides countdown.
 * Supports both SELL (exact input) and BUY (exact output) modes.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getParaswapQuote,
  type ParaswapQuoteResult,
  type ParaswapSide,
  type ParaswapSupportedChainId,
} from '@/lib/paraswap-client';

export interface UseParaswapQuoteParams {
  chainId: number | undefined;
  srcToken: string | undefined;
  srcDecimals: number | undefined;
  destToken: string | undefined;
  destDecimals: number | undefined;
  amount: string | undefined;
  userAddress: string | undefined;
  side?: ParaswapSide;
  enabled?: boolean;
  autoRefresh?: boolean;
  refetchInterval?: number;
}

export interface UseParaswapQuoteResult {
  quote: ParaswapQuoteResult | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  isExpired: boolean;
  secondsUntilExpiry: number | null;
  refreshQuote: () => void;
}

export function useParaswapQuote({
  chainId,
  srcToken,
  srcDecimals,
  destToken,
  destDecimals,
  amount,
  userAddress,
  side = 'SELL',
  enabled = true,
  autoRefresh = true,
  refetchInterval = 15000,
}: UseParaswapQuoteParams): UseParaswapQuoteResult {
  const [now, setNow] = useState(Date.now());

  const hasAllParams =
    chainId !== undefined &&
    srcToken !== undefined &&
    srcDecimals !== undefined &&
    destToken !== undefined &&
    destDecimals !== undefined &&
    amount !== undefined &&
    amount !== '0' &&
    userAddress !== undefined;

  const queryParams = useMemo(
    () => ({
      chainId: chainId ?? 0,
      srcToken: srcToken ?? '',
      destToken: destToken ?? '',
      amount: amount ?? '',
      userAddress: userAddress ?? '',
      side,
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
    queryKey: ['swap', 'paraswap-quote', queryParams],
    queryFn: async () => {
      if (!hasAllParams) throw new Error('Missing required params');

      return getParaswapQuote({
        chainId: chainId as ParaswapSupportedChainId,
        srcToken: srcToken!,
        srcDecimals: srcDecimals!,
        destToken: destToken!,
        destDecimals: destDecimals!,
        amount: amount!,
        userAddress: userAddress!,
        side,
      });
    },
    enabled: enabled && hasAllParams,
    staleTime: 10000,
    refetchInterval: autoRefresh ? refetchInterval : false,
  });

  // Update "now" every second for countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const expiresAt = useMemo(() => {
    if (!data?.expiresAt) return null;
    return new Date(data.expiresAt);
  }, [data?.expiresAt]);

  const isExpired = useMemo(() => {
    if (!expiresAt) return false;
    return now > expiresAt.getTime();
  }, [expiresAt, now]);

  const secondsUntilExpiry = useMemo(() => {
    if (!expiresAt) return null;
    const remaining = Math.floor((expiresAt.getTime() - now) / 1000);
    return Math.max(0, remaining);
  }, [expiresAt, now]);

  const refreshQuote = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    quote: data ?? null,
    isLoading,
    isFetching,
    isError,
    error: error as Error | null,
    isExpired,
    secondsUntilExpiry,
    refreshQuote,
  };
}
