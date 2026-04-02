/**
 * Input types for FavoritePoolService
 *
 * These types define the parameters accepted by FavoritePoolService methods.
 * They are internal to the services layer and not exported to consumers.
 */

/**
 * Input for adding a pool as a favorite
 *
 * The service will discover the pool (triggering token discovery) before saving.
 */
export interface AddFavoritePoolInput {
  /** User ID who is adding the favorite */
  userId: string;

  /** Chain ID where the pool is deployed */
  chainId: number;

  /** Pool contract address (will be validated and normalized) */
  poolAddress: string;
}

/**
 * Input for removing a pool from favorites by chain and address
 *
 * Used by API endpoints that identify pools by chainId + poolAddress.
 */
export interface RemoveFavoritePoolByAddressInput {
  /** User ID who is removing the favorite */
  userId: string;

  /** Chain ID where the pool is deployed */
  chainId: number;

  /** Pool contract address (will be validated and normalized) */
  poolAddress: string;
}

/**
 * Input for listing a user's favorite pools
 */
export interface ListFavoritePoolsInput {
  /** User ID whose favorites to list */
  userId: string;

  /** Maximum number of results (optional, default: 50) */
  limit?: number;

  /** Offset for pagination (optional, default: 0) */
  offset?: number;
}
