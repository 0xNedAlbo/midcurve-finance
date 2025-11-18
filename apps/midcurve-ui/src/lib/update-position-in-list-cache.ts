/**
 * Update a specific position in all list caches
 *
 * Finds all position list queries and updates the matching position
 * with fresh data from an update mutation.
 *
 * This provides instant UI updates without refetching the entire list.
 */

import type { QueryClient } from "@tanstack/react-query";
import type {
  ListPositionsResponse,
  UpdateUniswapV3PositionData,
} from "@midcurve/api-shared";
import { queryKeys } from "@/lib/query-keys";

/**
 * Update a position in all list caches
 *
 * @param queryClient - TanStack Query client instance
 * @param updatedPosition - Fresh position data from update mutation
 * @returns Number of caches updated
 *
 * @example
 * ```typescript
 * const cachesUpdated = updatePositionInListCache(queryClient, updatedPosition);
 * console.log(`Updated position in ${cachesUpdated} caches`);
 * ```
 */
export function updatePositionInListCache(
  queryClient: QueryClient,
  updatedPosition: UpdateUniswapV3PositionData
): number {
  let cachesUpdated = 0;

  // Get all list query caches
  const listQueries = queryClient.getQueriesData<ListPositionsResponse>({
    queryKey: queryKeys.positions.lists(), // ['positions', 'list']
  });

  // Update each cache that contains this position
  for (const [queryKey, cacheData] of listQueries) {
    if (!cacheData?.data) continue;

    // Find position index in this cache
    const positionIndex = cacheData.data.findIndex(
      (pos) => pos.id === updatedPosition.id
    );

    if (positionIndex === -1) {
      // Position not in this cache (filtered out, wrong page, etc.)
      continue;
    }

    // Update the cache with new position
    queryClient.setQueryData<ListPositionsResponse>(queryKey, {
      ...cacheData,
      data: [
        ...cacheData.data.slice(0, positionIndex),
        updatedPosition,
        ...cacheData.data.slice(positionIndex + 1),
      ],
    });

    cachesUpdated++;
  }

  return cachesUpdated;
}
