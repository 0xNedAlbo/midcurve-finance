/**
 * Invalidate position list caches after a position update
 *
 * Since the list endpoint returns slim PositionListItem data while
 * position mutations return full protocol-specific data, we invalidate
 * rather than patch in-place. TanStack Query will refetch automatically.
 */

import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

/**
 * Invalidate all position list caches
 *
 * Call this after any position mutation (update, delete, etc.) to
 * ensure the list view reflects the latest state.
 *
 * @param queryClient - TanStack Query client instance
 */
export function invalidatePositionListCaches(
  queryClient: QueryClient
): void {
  queryClient.invalidateQueries({
    queryKey: queryKeys.positions.lists(),
  });
}
