/**
 * useUniswapV3AutoRefresh - Periodic on-chain refresh for a Uniswap V3 position
 *
 * Calls POST /api/v1/positions/uniswapv3/:chainId/:nftId/refresh on mount
 * and every 60 seconds to sync on-chain state (unclaimed fees, APR, liquidity)
 * into the database.
 *
 * This is fire-and-forget — the response is not used to update React Query cache.
 * Instead, the 3-second DB polling via useUniswapV3Position picks up changes.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { apiClientFn } from "@/lib/api-client";

const REFRESH_INTERVAL_MS = 60_000;

export function useUniswapV3AutoRefresh(chainId: number, nftId: string) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Abort any in-flight request before starting a new one
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsRefreshing(true);
    try {
      await apiClientFn(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}/refresh`,
        { method: "POST", signal: controller.signal }
      );
    } catch {
      // Fire-and-forget: silently ignore errors (aborts, network failures, etc.)
    } finally {
      if (!controller.signal.aborted) {
        setIsRefreshing(false);
      }
    }
  }, [chainId, nftId]);

  useEffect(() => {
    // Refresh immediately on mount
    refresh();

    // Then refresh every 60s
    const intervalId = setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      abortControllerRef.current?.abort();
      setIsRefreshing(false);
    };
  }, [refresh]);

  return { isRefreshing };
}
