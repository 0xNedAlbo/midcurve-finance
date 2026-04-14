/**
 * useUniswapV3VaultAutoRefresh - Periodic on-chain refresh for vault positions
 *
 * Calls POST refresh on mount and every 60 seconds. Fire-and-forget.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { apiClientFn } from "@/lib/api-client";

const REFRESH_INTERVAL_MS = 60_000;

export function useUniswapV3VaultAutoRefresh(chainId: number, vaultAddress: string, ownerAddress: string) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsRefreshing(true);
    try {
      await apiClientFn(
        `/api/v1/positions/uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}/refresh`,
        { method: "POST", signal: controller.signal }
      );
    } catch {
      // Fire-and-forget
    } finally {
      if (!controller.signal.aborted) {
        setIsRefreshing(false);
      }
    }
  }, [chainId, vaultAddress, ownerAddress]);

  useEffect(() => {
    refresh();
    const intervalId = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
      abortControllerRef.current?.abort();
      setIsRefreshing(false);
    };
  }, [refresh]);

  return { isRefreshing };
}
