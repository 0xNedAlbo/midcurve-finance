/**
 * User Settings Type Definitions
 *
 * Generic per-user settings stored as a single JSON structure.
 * Each user has at most one UserSettings row in the database.
 */

/**
 * UserSettingsData interface
 *
 * Defines the shape of the settings JSON column.
 * New settings fields should be added here with sensible defaults
 * reflected in DEFAULT_USER_SETTINGS.
 */
export interface UserSettingsData {
  /**
   * Pool hashes the user has favorited for quick access.
   * Format: "{protocol}/{chainId}/{poolAddress}" (e.g. "uniswapv3/42161/0xABC...")
   * Ordered most-recent-first (new favorites prepended).
   */
  favoritePoolHashes: string[];
}

/**
 * Default settings for new users or when no settings row exists.
 */
export const DEFAULT_USER_SETTINGS: UserSettingsData = {
  favoritePoolHashes: [],
};
