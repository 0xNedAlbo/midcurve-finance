/**
 * Pool Favorites Hooks
 *
 * React Query hooks for managing user's favorite pools.
 * All operations use the protocol-agnostic favorites API.
 *
 * Hooks:
 * - usePoolFavorites - List favorite pools
 * - useAddPoolFavorite - Add pool to favorites
 * - useRemovePoolFavorite - Remove pool from favorites
 * - useTogglePoolFavorite - Toggle favorite status
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ListFavoritePoolsData,
  AddFavoritePoolData,
  RemoveFavoritePoolData,
} from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

// ============================================================================
// LIST FAVORITES
// ============================================================================

/**
 * Hook props for usePoolFavorites
 */
export interface UsePoolFavoritesProps {
  /**
   * Optional protocol filter
   * @example "uniswapv3"
   */
  protocol?: string;

  /**
   * Maximum results to return
   * @default 50
   */
  limit?: number;

  /**
   * Pagination offset
   * @default 0
   */
  offset?: number;

  /**
   * Enable/disable the query
   * @default true
   */
  enabled?: boolean;
}

/**
 * React Query hook for listing user's favorite pools
 */
export function usePoolFavorites({
  protocol = 'uniswapv3',
  limit = 50,
  offset = 0,
  enabled = true,
}: UsePoolFavoritesProps = {}) {
  return useQuery({
    queryKey: queryKeys.pools.favorites.list(protocol),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (protocol) params.set('protocol', protocol);
      if (limit) params.set('limit', String(limit));
      if (offset) params.set('offset', String(offset));

      const response = await apiClient.get<ListFavoritePoolsData>(
        `/api/v1/pools/favorites?${params.toString()}`
      );
      return response.data;
    },
    enabled,
    staleTime: 60000, // 1 minute
    gcTime: 300000, // 5 minutes
  });
}

// ============================================================================
// ADD FAVORITE
// ============================================================================

/**
 * Input for adding a pool to favorites.
 *
 * `isToken0Quote` (optional) pins a base/quote orientation to the favorite —
 * surfaces on subsequent reads via `FavoritePoolItem.userProvidedInfo`.
 */
export interface AddFavoriteInput {
  protocol: string;
  chainId: number;
  poolAddress: string;
  isToken0Quote?: boolean;
}

/**
 * React Query mutation hook for adding a pool to favorites
 */
export function useAddPoolFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddFavoriteInput) => {
      const response = await apiClient.post<AddFavoritePoolData>(
        '/api/v1/pools/favorites',
        {
          protocol: input.protocol,
          chainId: input.chainId,
          poolAddress: input.poolAddress,
          ...(typeof input.isToken0Quote === 'boolean' && {
            isToken0Quote: input.isToken0Quote,
          }),
        }
      );
      return response.data;
    },
    onSuccess: () => {
      // Invalidate favorites list
      queryClient.invalidateQueries({
        queryKey: queryKeys.pools.favorites.all(),
      });

      // Invalidate pool search to update isFavorite status
      queryClient.invalidateQueries({
        queryKey: queryKeys.pools.uniswapv3.searches(),
      });
    },
  });
}

// ============================================================================
// REMOVE FAVORITE
// ============================================================================

/**
 * Input for removing a pool from favorites
 */
export interface RemoveFavoriteInput {
  protocol: string;
  chainId: number;
  poolAddress: string;
}

/**
 * React Query mutation hook for removing a pool from favorites
 */
export function useRemovePoolFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RemoveFavoriteInput) => {
      const params = new URLSearchParams({
        protocol: input.protocol,
        chainId: String(input.chainId),
        address: input.poolAddress,
      });

      const response = await apiClient.delete<RemoveFavoritePoolData>(
        `/api/v1/pools/favorites?${params.toString()}`
      );
      return response.data;
    },
    onSuccess: () => {
      // Invalidate favorites list
      queryClient.invalidateQueries({
        queryKey: queryKeys.pools.favorites.all(),
      });

      // Invalidate pool search to update isFavorite status
      queryClient.invalidateQueries({
        queryKey: queryKeys.pools.uniswapv3.searches(),
      });
    },
  });
}

// ============================================================================
// TOGGLE FAVORITE
// ============================================================================

/**
 * Input for toggling a pool's favorite status.
 *
 * On the add path, `isToken0Quote` (optional) pins the base/quote orientation
 * for the favorite — typically forwarded from the active search result's
 * `userProvidedInfo.isToken0Quote`. Ignored on the remove path.
 */
export interface ToggleFavoriteInput {
  protocol: string;
  chainId: number;
  poolAddress: string;
  isFavorite: boolean;
  isToken0Quote?: boolean;
}

/**
 * React Query mutation hook for toggling a pool's favorite status
 *
 * Combines add/remove based on current state.
 * Makes direct API calls to ensure proper cache invalidation.
 */
export function useTogglePoolFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ToggleFavoriteInput) => {
      if (input.isFavorite) {
        // Currently favorited, so remove
        const params = new URLSearchParams({
          protocol: input.protocol,
          chainId: String(input.chainId),
          address: input.poolAddress,
        });

        const response = await apiClient.delete<RemoveFavoritePoolData>(
          `/api/v1/pools/favorites?${params.toString()}`
        );
        return { action: 'removed' as const, data: response.data };
      } else {
        // Not favorited, so add — forward isToken0Quote if the caller has
        // an active orientation (search-tab path); omit otherwise.
        const response = await apiClient.post<AddFavoritePoolData>(
          '/api/v1/pools/favorites',
          {
            protocol: input.protocol,
            chainId: input.chainId,
            poolAddress: input.poolAddress,
            ...(typeof input.isToken0Quote === 'boolean' && {
              isToken0Quote: input.isToken0Quote,
            }),
          }
        );
        return { action: 'added' as const, data: response.data };
      }
    },
    onSuccess: () => {
      // Invalidate favorites list
      queryClient.invalidateQueries({
        queryKey: queryKeys.pools.favorites.all(),
      });

      // Invalidate pool search to update isFavorite status
      queryClient.invalidateQueries({
        queryKey: queryKeys.pools.uniswapv3.searches(),
      });
    },
  });
}
