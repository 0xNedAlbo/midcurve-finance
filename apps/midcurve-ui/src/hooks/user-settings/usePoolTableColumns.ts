/**
 * Pool Table Columns Hooks
 *
 * React Query hooks for the user's persisted pool-table column visibility.
 *
 * - useGetPoolTableColumns: read the visible-column list
 * - useUpdatePoolTableColumns: replace the visible-column list (optimistic)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PoolTableColumnId } from '@midcurve/shared';
import type { PoolTableColumnsData } from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const ENDPOINT = '/api/v1/user/me/settings/pool-table-columns';

export function useGetPoolTableColumns(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.user.settings.poolTableColumns(),
    queryFn: async () => {
      const response = await apiClient.get<PoolTableColumnsData>(ENDPOINT);
      return response.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useUpdatePoolTableColumns() {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.user.settings.poolTableColumns();

  return useMutation<
    PoolTableColumnsData,
    Error,
    PoolTableColumnId[],
    { previous: PoolTableColumnsData | undefined }
  >({
    mutationFn: async (visibleColumns: PoolTableColumnId[]) => {
      const response = await apiClient.put<PoolTableColumnsData>(ENDPOINT, {
        visibleColumns,
      });
      return response.data;
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PoolTableColumnsData>(queryKey);
      queryClient.setQueryData<PoolTableColumnsData>(queryKey, {
        visibleColumns: next,
      });
      return { previous };
    },
    onError: (_err, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData<PoolTableColumnsData>(queryKey, data);
    },
  });
}
