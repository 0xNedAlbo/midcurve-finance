/**
 * useArchivePosition - Mutation hook for archiving/unarchiving positions
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface ArchivePositionParams {
  positionId: string;
  archive: boolean;
}

export function useArchivePosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ positionId, archive }: ArchivePositionParams) => {
      return apiClient.patch<{ positionId: string; isArchived: boolean }>(
        '/api/v1/positions/archive',
        { positionId, archive },
      );
    },
    onSuccess: () => {
      // Invalidate position list to reflect the change
      queryClient.invalidateQueries({ queryKey: queryKeys.positions.lists() });
    },
  });
}
