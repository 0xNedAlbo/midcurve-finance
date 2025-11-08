/**
 * AuthNonceService
 *
 * Manages nonces for SIWE (Sign-In with Ethereum) authentication.
 * Uses existing CacheService for PostgreSQL-based storage with TTL.
 *
 * SECURITY:
 * - Nonces expire after 10 minutes
 * - Single-use (consumed after validation)
 * - Prevents replay attacks
 */

import { CacheService } from '../cache/cache-service.js';

export interface AuthNonceServiceDependencies {
  cacheService?: CacheService;
}

export class AuthNonceService {
  private readonly cacheService: CacheService;
  private readonly NONCE_TTL = 600; // 10 minutes in seconds
  private readonly NONCE_PREFIX = 'nonce:';

  constructor(dependencies: AuthNonceServiceDependencies = {}) {
    this.cacheService = dependencies.cacheService ?? CacheService.getInstance();
  }

  /**
   * Generate new nonce for SIWE authentication
   *
   * @returns Nonce string (alphanumeric only, min 8 chars)
   *
   * @example
   * ```typescript
   * const nonce = await service.generateNonce();
   * // Returns: "a1b2c3d4e5f6..."
   * ```
   */
  async generateNonce(): Promise<string> {
    // SIWE requires alphanumeric-only nonces (no special characters)
    // Use customAlphabet to generate only alphanumeric characters
    const { customAlphabet } = await import('nanoid');
    const generateAlphanumeric = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 32);
    const nonce = generateAlphanumeric();
    const key = `${this.NONCE_PREFIX}${nonce}`;

    await this.cacheService.set(key, { createdAt: new Date().toISOString() }, this.NONCE_TTL);

    return nonce;
  }

  /**
   * Validate nonce exists and is not expired
   *
   * @param nonce - Nonce to validate
   * @returns true if valid, false if expired or doesn't exist
   *
   * @example
   * ```typescript
   * const isValid = await service.validateNonce('siwe_a1b2c3d4e5f6...');
   * if (isValid) {
   *   // Proceed with SIWE verification
   * }
   * ```
   */
  async validateNonce(nonce: string): Promise<boolean> {
    const key = `${this.NONCE_PREFIX}${nonce}`;
    const data = await this.cacheService.get(key);
    return data !== null;
  }

  /**
   * Consume nonce after use (delete from cache)
   *
   * This prevents replay attacks by ensuring nonces can only be used once.
   *
   * @param nonce - Nonce to consume
   *
   * @example
   * ```typescript
   * // After successful SIWE verification
   * await service.consumeNonce('siwe_a1b2c3d4e5f6...');
   * ```
   */
  async consumeNonce(nonce: string): Promise<void> {
    const key = `${this.NONCE_PREFIX}${nonce}`;
    await this.cacheService.delete(key);
  }
}
