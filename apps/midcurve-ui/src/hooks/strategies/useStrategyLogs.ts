/**
 * useStrategyLogs - Strategy Execution Logs Hook
 *
 * Fetches strategy execution logs (DEBUG, INFO, WARN, ERROR) with:
 * - Cursor-based pagination
 * - Log level filtering
 * - Infinite query support for "Load More" functionality
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type {
  LogLevel,
  StrategyLogsResponseData,
} from "@midcurve/api-shared";

interface UseStrategyLogsParams {
  /**
   * Strategy ID to fetch logs for
   */
  strategyId: string;

  /**
   * Filter by log level (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
   */
  level?: LogLevel;

  /**
   * Number of logs to fetch per page
   * @default 50
   */
  limit?: number;

  /**
   * Whether the query is enabled
   * @default true
   */
  enabled?: boolean;
}

/**
 * Fetch strategy logs with pagination and filtering
 */
export function useStrategyLogs({
  strategyId,
  level,
  limit = 50,
  enabled = true,
}: UseStrategyLogsParams) {
  return useInfiniteQuery({
    queryKey: queryKeys.strategies.logsWithParams(strategyId, { level }),
    queryFn: async ({ pageParam }): Promise<StrategyLogsResponseData> => {
      const API_BASE_URL = import.meta.env.VITE_API_URL || "";

      // Build query string
      const params = new URLSearchParams();
      params.set("limit", limit.toString());

      if (level !== undefined) {
        params.set("level", level.toString());
      }

      if (pageParam) {
        params.set("cursor", pageParam);
      }

      const response = await fetch(
        `${API_BASE_URL}/api/v1/strategies/${strategyId}/logs?${params.toString()}`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error?.message || "Failed to fetch strategy logs");
      }

      const data = await response.json();
      return data.data as StrategyLogsResponseData;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      // Return the cursor for the next page, or undefined if no more pages
      return lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined;
    },
    staleTime: 10_000, // 10 seconds - logs can change frequently
    enabled: enabled && !!strategyId,
  });
}

/**
 * Get all logs from infinite query pages (flattened)
 */
export function flattenLogPages(
  pages: StrategyLogsResponseData[] | undefined
): StrategyLogsResponseData["logs"] {
  if (!pages) return [];
  return pages.flatMap((page) => page.logs);
}
