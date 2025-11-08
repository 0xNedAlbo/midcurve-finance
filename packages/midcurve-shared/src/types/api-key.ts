/**
 * API Key Display Type
 *
 * Safe representation of an API key for display purposes.
 * Does NOT include the key hash or full key value.
 */

/**
 * API key display information
 *
 * This is the safe version of an API key that can be shown to users.
 * The full key value is only shown once at creation time and cannot be recovered.
 */
export interface ApiKeyDisplay {
  /**
   * Unique identifier (database-generated)
   */
  id: string;

  /**
   * User-friendly name for the API key
   * Examples: "Production API", "Development", "CI/CD Pipeline"
   */
  name: string;

  /**
   * First 8 characters of the key for identification
   * Format: "mc_live_" (prefix only)
   * Full key format: mc_live_{32_char_random_string}
   */
  keyPrefix: string;

  /**
   * Timestamp of last usage
   * Null if never used
   */
  lastUsed: Date | null;

  /**
   * Creation timestamp
   */
  createdAt: Date;

  /**
   * Last update timestamp
   */
  updatedAt: Date;
}
