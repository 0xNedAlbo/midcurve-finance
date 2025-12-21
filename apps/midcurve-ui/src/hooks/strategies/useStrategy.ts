/**
 * useStrategy - Single strategy hook
 *
 * Fetches a single strategy by ID.
 * Uses the list endpoint and finds the matching strategy.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ListStrategyData, ListStrategiesResponse } from "@midcurve/api-shared";

export function useStrategy(
  strategyId: string,
  options?: Omit<
    UseQueryOptions<ListStrategyData | null>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: queryKeys.strategies.detail(strategyId),
    queryFn: async (): Promise<ListStrategyData | null> => {
      // Fetch strategy list including positions
      const API_BASE_URL = import.meta.env.VITE_API_URL || "";
      const response = await fetch(
        `${API_BASE_URL}/api/v1/strategies/list?includePositions=true&limit=100`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error?.message || "Failed to fetch strategy");
      }

      const data = (await response.json()) as ListStrategiesResponse;

      // Find the strategy by ID
      const strategy = data.data.find((s) => s.id === strategyId);

      return strategy || null;
    },
    staleTime: 30_000, // 30 seconds
    enabled: !!strategyId,
    ...options,
  });
}
