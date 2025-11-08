/**
 * Cryptographic Utilities
 *
 * Utility functions for hashing and key management.
 */

import { createHash } from 'crypto';

/**
 * Hash API key with SHA-256
 *
 * @param key - API key to hash
 * @returns SHA-256 hash as hex string
 *
 * @example
 * ```typescript
 * const hash = hashApiKey('mc_live_abc123...');
 * // Returns: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'
 * ```
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
