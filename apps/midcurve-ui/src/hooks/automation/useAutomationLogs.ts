/**
 * useAutomationLogs - Fetch automation logs for a position
 *
 * Fetches automation activity logs filtered by position ID.
 * Supports level filtering and polling for positions with active orders.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import type { AutomationLogData, ListAutomationLogsResponseData } from '@midcurve/api-shared';

interface UseAutomationLogsParams {
  /**
   * Position ID to fetch logs for (required)
   */
  positionId: string;

  /**
   * Filter by log level (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
   */
  level?: number;

  /**
   * Max results per page (default 20, max 100)
   */
  limit?: number;

  /**
   * Enable polling when position has active orders
   */
  polling?: boolean;
}

interface UseAutomationLogsOptions
  extends Omit<UseQueryOptions<ListAutomationLogsResponseData>, 'queryKey' | 'queryFn'> {
  /**
   * Enable or disable the query (default: true when positionId is provided)
   */
  enabled?: boolean;
}

/**
 * Hook to fetch automation logs for a position
 *
 * @param params - Query parameters
 * @param options - React Query options
 * @returns Query result with logs, pagination info, and query state
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useAutomationLogs(
 *   { positionId: 'pos_123', level: 3 }, // Only errors
 *   { polling: true }
 * );
 *
 * // Access logs
 * data?.logs.forEach(log => console.log(log.message));
 *
 * // Check pagination
 * if (data?.hasMore) {
 *   // Can load more with cursor
 * }
 * ```
 */
export function useAutomationLogs(
  params: UseAutomationLogsParams,
  options?: UseAutomationLogsOptions
) {
  const { positionId, level, limit = 20, polling = false } = params;
  const { enabled = true, ...queryOptions } = options ?? {};

  return useQuery({
    queryKey: queryKeys.automation.logs.byPosition(positionId),
    queryFn: async () => {
      const response = await automationApi.listLogs({
        positionId,
        level,
        limit,
      });
      return response.data;
    },
    enabled: enabled && !!positionId,
    staleTime: 30_000, // 30 seconds
    refetchInterval: polling ? 10_000 : false, // Poll every 10s if enabled
    ...queryOptions,
  });
}

/**
 * Type for a single automation log entry
 */
export type { AutomationLogData };

/**
 * Type for the logs response data
 */
export type { ListAutomationLogsResponseData };
