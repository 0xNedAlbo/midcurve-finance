/**
 * User Settings Type Definitions
 *
 * Generic per-user settings stored as a single JSON structure.
 * Each user has at most one UserSettings row in the database.
 */

/**
 * Cost basis tracking method for token lot disposals.
 *
 * - 'fifo': First In, First Out — oldest lots consumed first
 * - 'lifo': Last In, First Out — newest lots consumed first
 * - 'hifo': Highest In, First Out — highest cost basis lots consumed first
 * - 'wac': Weighted Average Cost — blended cost basis across all open lots
 */
export type CostBasisMethod = 'fifo' | 'lifo' | 'hifo' | 'wac';

/**
 * A single favorite-pool entry persisted in `UserSettingsData.favoritePoolHashes`.
 *
 * Pre-issue-#45 entries were plain strings (`hash`-only). The lazy
 * backwards-compat read normalizes legacy string entries into this shape on
 * the fly with `isToken0Quote` undefined; writes always use this object form.
 */
export interface FavoritePoolEntry {
  /**
   * Pool hash identifier — `{protocol}/{chainId}/{poolAddress}` (EIP-55).
   * @example "uniswapv3/42161/0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
   */
  hash: string;

  /**
   * Optional base/quote orientation pinned to this favorite.
   *
   * `undefined` means no orientation was set (legacy entries or favorites
   * added without a role context, e.g. from the Direct Address flow).
   */
  isToken0Quote?: boolean;
}

/**
 * UserSettingsData interface
 *
 * Defines the shape of the settings JSON column.
 * New settings fields should be added here with sensible defaults
 * reflected in DEFAULT_USER_SETTINGS.
 */
export interface UserSettingsData {
  /**
   * Pools the user has favorited for quick access.
   *
   * Each entry carries the pool hash and an optional pinned base/quote
   * orientation. Ordered most-recent-first (new favorites prepended).
   *
   * **Storage compatibility**: legacy installations may have stored this
   * field as `string[]`. Reads normalize legacy entries to
   * `FavoritePoolEntry` on the fly; writes always emit the object shape.
   */
  favoritePoolHashes: FavoritePoolEntry[];

  /**
   * Cost basis method for realized PnL calculations.
   * Determines how token lots are selected for disposal.
   */
  costBasisMethod: CostBasisMethod;
}

/**
 * Default settings for new users or when no settings row exists.
 */
export const DEFAULT_USER_SETTINGS: UserSettingsData = {
  favoritePoolHashes: [],
  costBasisMethod: 'fifo',
};
