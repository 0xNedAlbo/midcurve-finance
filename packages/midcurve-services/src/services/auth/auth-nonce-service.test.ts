/**
 * AuthNonceService Tests
 *
 * Unit tests for AuthNonceService nonce management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AuthNonceService } from './auth-nonce-service.js';
import type { CacheService } from '../cache/cache-service.js';

describe('AuthNonceService', () => {
  let cacheServiceMock: DeepMockProxy<CacheService>;
  let authNonceService: AuthNonceService;

  beforeEach(() => {
    cacheServiceMock = mockDeep<CacheService>();
    authNonceService = new AuthNonceService({ cacheService: cacheServiceMock });
  });

  // ===========================================================================
  // generateNonce
  // ===========================================================================

  describe('generateNonce', () => {
    it('should generate nonce with correct format', async () => {
      // Arrange
      cacheServiceMock.set.mockResolvedValue(undefined);

      // Act
      const nonce = await authNonceService.generateNonce();

      // Assert
      expect(nonce).toMatch(/^siwe_[A-Za-z0-9_-]{32}$/);
      expect(nonce.length).toBe(37); // "siwe_" (5) + 32 chars
    });

    it('should store nonce in cache with correct TTL', async () => {
      // Arrange
      cacheServiceMock.set.mockResolvedValue(undefined);

      // Act
      const nonce = await authNonceService.generateNonce();

      // Assert
      expect(cacheServiceMock.set).toHaveBeenCalledWith(
        `nonce:${nonce}`,
        { createdAt: expect.any(String) },
        600 // 10 minutes
      );
    });

    it('should use nonce: prefix for cache key', async () => {
      // Arrange
      cacheServiceMock.set.mockResolvedValue(undefined);

      // Act
      const nonce = await authNonceService.generateNonce();

      // Assert
      const cacheKey = `nonce:${nonce}`;
      expect(cacheServiceMock.set).toHaveBeenCalledWith(
        cacheKey,
        expect.any(Object),
        600
      );
    });

    it('should generate unique nonces', async () => {
      // Arrange
      cacheServiceMock.set.mockResolvedValue(undefined);

      // Act
      const nonce1 = await authNonceService.generateNonce();
      const nonce2 = await authNonceService.generateNonce();
      const nonce3 = await authNonceService.generateNonce();

      // Assert
      expect(nonce1).not.toBe(nonce2);
      expect(nonce2).not.toBe(nonce3);
      expect(nonce1).not.toBe(nonce3);
    });

    it('should include timestamp in cached data', async () => {
      // Arrange
      cacheServiceMock.set.mockResolvedValue(undefined);

      // Act
      await authNonceService.generateNonce();

      // Assert
      expect(cacheServiceMock.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          createdAt: expect.any(String),
        }),
        600
      );
    });
  });

  // ===========================================================================
  // validateNonce
  // ===========================================================================

  describe('validateNonce', () => {
    it('should return true for valid nonce', async () => {
      // Arrange
      const nonce = 'siwe_abc123xyz789def456ghi012jkl345';
      cacheServiceMock.get.mockResolvedValue({
        createdAt: new Date().toISOString(),
      });

      // Act
      const result = await authNonceService.validateNonce(nonce);

      // Assert
      expect(result).toBe(true);
      expect(cacheServiceMock.get).toHaveBeenCalledWith(`nonce:${nonce}`);
    });

    it('should return false for expired/non-existent nonce', async () => {
      // Arrange
      const nonce = 'siwe_expired_or_nonexistent';
      cacheServiceMock.get.mockResolvedValue(null);

      // Act
      const result = await authNonceService.validateNonce(nonce);

      // Assert
      expect(result).toBe(false);
    });

    it('should use correct cache key prefix', async () => {
      // Arrange
      const nonce = 'siwe_test123';
      cacheServiceMock.get.mockResolvedValue({ createdAt: new Date().toISOString() });

      // Act
      await authNonceService.validateNonce(nonce);

      // Assert
      expect(cacheServiceMock.get).toHaveBeenCalledWith(`nonce:${nonce}`);
    });

    it('should handle cache errors gracefully', async () => {
      // Arrange
      const nonce = 'siwe_error_test';
      cacheServiceMock.get.mockRejectedValue(new Error('Cache unavailable'));

      // Act & Assert - Should not throw
      await expect(authNonceService.validateNonce(nonce)).rejects.toThrow(
        'Cache unavailable'
      );
    });
  });

  // ===========================================================================
  // consumeNonce
  // ===========================================================================

  describe('consumeNonce', () => {
    it('should delete nonce from cache', async () => {
      // Arrange
      const nonce = 'siwe_consume_test';
      cacheServiceMock.delete.mockResolvedValue(undefined);

      // Act
      await authNonceService.consumeNonce(nonce);

      // Assert
      expect(cacheServiceMock.delete).toHaveBeenCalledWith(`nonce:${nonce}`);
    });

    it('should use correct cache key prefix', async () => {
      // Arrange
      const nonce = 'siwe_abc123';
      cacheServiceMock.delete.mockResolvedValue(undefined);

      // Act
      await authNonceService.consumeNonce(nonce);

      // Assert
      expect(cacheServiceMock.delete).toHaveBeenCalledWith(`nonce:${nonce}`);
    });

    it('should not throw error if nonce already consumed', async () => {
      // Arrange
      const nonce = 'siwe_already_consumed';
      cacheServiceMock.delete.mockResolvedValue(undefined);

      // Act & Assert - Should not throw
      await expect(authNonceService.consumeNonce(nonce)).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // Integration: Generate -> Validate -> Consume
  // ===========================================================================

  describe('Integration: Generate -> Validate -> Consume', () => {
    it('should follow single-use pattern', async () => {
      // Arrange
      const nonceData = { createdAt: new Date().toISOString() };
      cacheServiceMock.set.mockResolvedValue(undefined);
      cacheServiceMock.get
        .mockResolvedValueOnce(nonceData) // First validation: valid
        .mockResolvedValueOnce(null); // Second validation: consumed
      cacheServiceMock.delete.mockResolvedValue(undefined);

      // Act
      const nonce = await authNonceService.generateNonce();

      // Validate nonce (should be valid)
      const isValidBefore = await authNonceService.validateNonce(nonce);
      expect(isValidBefore).toBe(true);

      // Consume nonce
      await authNonceService.consumeNonce(nonce);

      // Validate again (should be invalid after consumption)
      const isValidAfter = await authNonceService.validateNonce(nonce);
      expect(isValidAfter).toBe(false);
    });
  });

  // ===========================================================================
  // TTL and Expiration
  // ===========================================================================

  describe('TTL and Expiration', () => {
    it('should set TTL to 600 seconds (10 minutes)', async () => {
      // Arrange
      cacheServiceMock.set.mockResolvedValue(undefined);

      // Act
      await authNonceService.generateNonce();

      // Assert
      expect(cacheServiceMock.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        600
      );
    });

    it('should treat expired nonce as invalid', async () => {
      // Arrange - CacheService returns null for expired entries
      const expiredNonce = 'siwe_expired123';
      cacheServiceMock.get.mockResolvedValue(null);

      // Act
      const result = await authNonceService.validateNonce(expiredNonce);

      // Assert
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Nonce Format Validation
  // ===========================================================================

  describe('Nonce Format', () => {
    it('should generate nonces starting with "siwe_"', async () => {
      // Arrange
      cacheServiceMock.set.mockResolvedValue(undefined);

      // Act
      const nonce = await authNonceService.generateNonce();

      // Assert
      expect(nonce.startsWith('siwe_')).toBe(true);
    });

    it('should generate 32-character random suffix', async () => {
      // Arrange
      cacheServiceMock.set.mockResolvedValue(undefined);

      // Act
      const nonce = await authNonceService.generateNonce();

      // Assert
      const suffix = nonce.substring(5); // Remove "siwe_"
      expect(suffix.length).toBe(32);
      expect(suffix).toMatch(/^[A-Za-z0-9_-]+$/); // nanoid default alphabet
    });

    it('should work with any valid nonce format in validate/consume', async () => {
      // Arrange
      const customNonce = 'siwe_CustomFormat123';
      cacheServiceMock.get.mockResolvedValue({ createdAt: new Date().toISOString() });
      cacheServiceMock.delete.mockResolvedValue(undefined);

      // Act & Assert
      const isValid = await authNonceService.validateNonce(customNonce);
      expect(isValid).toBe(true);

      await expect(authNonceService.consumeNonce(customNonce)).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // Constructor
  // ===========================================================================

  describe('constructor', () => {
    it('should accept custom cache service', () => {
      // Arrange & Act
      const customService = new AuthNonceService({ cacheService: cacheServiceMock });

      // Assert
      expect(customService).toBeInstanceOf(AuthNonceService);
    });

    it('should work without dependencies (uses default CacheService)', () => {
      // Arrange & Act
      const defaultService = new AuthNonceService();

      // Assert
      expect(defaultService).toBeInstanceOf(AuthNonceService);
    });
  });
});
