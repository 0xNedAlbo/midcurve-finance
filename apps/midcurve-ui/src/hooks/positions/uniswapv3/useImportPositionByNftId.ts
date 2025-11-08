/**
 * useImportPositionByNftId - Import Uniswap V3 position by NFT ID
 *
 * Platform-specific mutation hook for importing positions from the blockchain.
 * Implements optimistic cache updates to show imported position immediately.
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient, ApiError } from '@/lib/api-client';
import type {
  ImportUniswapV3PositionResponse,
  ListPositionsResponse,
} from '@midcurve/api-shared';

interface ImportPositionByNftIdParams {
  chainId: number;
  nftId: string;
}

export function useImportPositionByNftId(
  options?: Omit<
    UseMutationOptions<
      ImportUniswapV3PositionResponse,
      ApiError,
      ImportPositionByNftIdParams,
      unknown
    >,
    'mutationFn' | 'onSuccess'
  >
) {
  const queryClient = useQueryClient();

  return useMutation({
    ...options,

    mutationFn: async (params: ImportPositionByNftIdParams) => {
      // Convert nftId from string to number for API validation
      const requestBody = {
        chainId: params.chainId,
        nftId: parseInt(params.nftId, 10),
      };

      return apiClient<ImportUniswapV3PositionResponse>(
        '/api/v1/positions/uniswapv3/import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );
    },

    onSuccess: (response, _variables, _context) => {
      const newPosition = response.data;

      // Strategy 1: Optimistically insert at top of ALL list queries
      // This ensures the imported position appears immediately in the current view
      queryClient.setQueriesData<ListPositionsResponse>(
        { queryKey: queryKeys.positions.lists() },
        (oldData) => {
          if (!oldData) return oldData;

          // Check if position already exists (import is idempotent)
          const exists = oldData.data.some(
            (p) => p.positionHash === newPosition.positionHash
          );

          if (exists) {
            // Replace existing position with fresh data
            return {
              ...oldData,
              data: oldData.data.map((p) =>
                p.positionHash === newPosition.positionHash ? newPosition : p
              ),
            };
          }

          // Insert at top (user intent - just imported this position)
          return {
            ...oldData,
            data: [newPosition, ...oldData.data],
            pagination: {
              ...oldData.pagination,
              total: oldData.pagination.total + 1,
            },
          };
        }
      );

      // Strategy 2: Cache the detail query for this specific position
      // If user navigates to detail page, data is already available
      queryClient.setQueryData(
        queryKeys.positions.uniswapv3.detail(
          newPosition.config.chainId,
          newPosition.config.nftId.toString()
        ),
        newPosition
      );

      // Strategy 3: Invalidate lists to refetch with correct server state
      // Background refetch ensures eventual consistency
      queryClient.invalidateQueries({
        queryKey: queryKeys.positions.lists(),
      });
    },
  });
}
