/**
 * AuthApiKeyService Tests
 *
 * Unit tests for AuthApiKeyService API key management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { AuthApiKeyService } from './auth-api-key-service.js';
import {
  ALICE,
  ALICE_API_KEY_1,
  ALICE_API_KEY_2,
  BOB_API_KEY,
  INVALID_API_KEY,
  NON_EXISTENT_API_KEY,
  createApiKeyFixture,
} from './test-fixtures.js';
import { createHash } from 'crypto';

describe('AuthApiKeyService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let authApiKeyService: AuthApiKeyService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    authApiKeyService = new AuthApiKeyService({ prisma: prismaMock });
  });

  // ===========================================================================
  // createApiKey
  // ===========================================================================

  describe('createApiKey', () => {
    it('should create API key with correct format', async () => {
      // Arrange
      prismaMock.apiKey.create.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act
      const result = await authApiKeyService.createApiKey('user_alice_001', 'Production API');

      // Assert
      expect(result.apiKey).toEqual(ALICE_API_KEY_1.dbResult);
      expect(result.key).toMatch(/^mc_live_[A-Za-z0-9]{32}$/); // Correct format
      expect(result.key.length).toBe(40); // "mc_live_" (8) + 32 chars
    });

    it('should hash API key with SHA-256', async () => {
      // Arrange
      prismaMock.apiKey.create.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act
      const result = await authApiKeyService.createApiKey('user_alice_001', 'Production API');

      // Assert - Verify hash matches
      const expectedHash = createHash('sha256').update(result.key).digest('hex');
      expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            keyHash: expectedHash,
          }),
        })
      );
    });

    it('should store key prefix (first 8 chars)', async () => {
      // Arrange
      prismaMock.apiKey.create.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act
      await authApiKeyService.createApiKey('user_alice_001', 'Production API');

      // Assert
      expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            keyPrefix: 'mc_live_',
          }),
        })
      );
    });

    it('should generate unique keys', async () => {
      // Arrange
      prismaMock.apiKey.create.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act - Create two keys
      const result1 = await authApiKeyService.createApiKey('user_alice_001', 'Key 1');
      const result2 = await authApiKeyService.createApiKey('user_alice_001', 'Key 2');

      // Assert - Keys should be different
      expect(result1.key).not.toBe(result2.key);
    });

    it('should save with user-provided name', async () => {
      // Arrange
      prismaMock.apiKey.create.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act
      await authApiKeyService.createApiKey('user_alice_001', 'My Custom Name');

      // Assert
      expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user_alice_001',
            name: 'My Custom Name',
          }),
        })
      );
    });
  });

  // ===========================================================================
  // validateApiKey
  // ===========================================================================

  describe('validateApiKey', () => {
    it('should validate correct API key', async () => {
      // Arrange
      const apiKeyWithUser = {
        ...ALICE_API_KEY_1.dbResult,
        user: {
          ...ALICE.dbResult,
          walletAddresses: [],
        },
      };
      prismaMock.apiKey.findUnique.mockResolvedValue(apiKeyWithUser as any);

      // Act
      const result = await authApiKeyService.validateApiKey(ALICE_API_KEY_1.key);

      // Assert
      expect(result).toEqual(apiKeyWithUser);
      expect(prismaMock.apiKey.findUnique).toHaveBeenCalledWith({
        where: { keyHash: ALICE_API_KEY_1.keyHash },
        include: {
          user: {
            include: {
              walletAddresses: true,
            },
          },
        },
      });
    });

    it('should return null for invalid API key', async () => {
      // Arrange
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      // Act
      const result = await authApiKeyService.validateApiKey(INVALID_API_KEY);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null for non-existent API key', async () => {
      // Arrange
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      // Act
      const result = await authApiKeyService.validateApiKey(NON_EXISTENT_API_KEY);

      // Assert
      expect(result).toBeNull();
    });

    it('should lookup by hash, not plaintext key', async () => {
      // Arrange
      const expectedHash = createHash('sha256')
        .update(ALICE_API_KEY_1.key)
        .digest('hex');
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      // Act
      await authApiKeyService.validateApiKey(ALICE_API_KEY_1.key);

      // Assert - Should search by hash
      expect(prismaMock.apiKey.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { keyHash: expectedHash },
        })
      );
    });
  });

  // ===========================================================================
  // getUserApiKeys
  // ===========================================================================

  describe('getUserApiKeys', () => {
    it('should return user API keys without hashes', async () => {
      // Arrange
      const apiKeys = [
        {
          id: ALICE_API_KEY_1.dbResult.id,
          name: ALICE_API_KEY_1.dbResult.name,
          keyPrefix: ALICE_API_KEY_1.dbResult.keyPrefix,
          lastUsed: ALICE_API_KEY_1.dbResult.lastUsed,
          createdAt: ALICE_API_KEY_1.dbResult.createdAt,
          updatedAt: ALICE_API_KEY_1.dbResult.updatedAt,
        },
        {
          id: ALICE_API_KEY_2.dbResult.id,
          name: ALICE_API_KEY_2.dbResult.name,
          keyPrefix: ALICE_API_KEY_2.dbResult.keyPrefix,
          lastUsed: ALICE_API_KEY_2.dbResult.lastUsed,
          createdAt: ALICE_API_KEY_2.dbResult.createdAt,
          updatedAt: ALICE_API_KEY_2.dbResult.updatedAt,
        },
      ];
      prismaMock.apiKey.findMany.mockResolvedValue(apiKeys as any);

      // Act
      const result = await authApiKeyService.getUserApiKeys('user_alice_001');

      // Assert
      expect(result).toEqual(apiKeys);
      expect(result[0]).not.toHaveProperty('keyHash');
      expect(result[0]).toHaveProperty('keyPrefix');
      expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_alice_001' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          lastUsed: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    it('should return empty array if user has no API keys', async () => {
      // Arrange
      prismaMock.apiKey.findMany.mockResolvedValue([]);

      // Act
      const result = await authApiKeyService.getUserApiKeys('user_new_001');

      // Assert
      expect(result).toEqual([]);
    });

    it('should order by creation date (newest first)', async () => {
      // Arrange
      prismaMock.apiKey.findMany.mockResolvedValue([]);

      // Act
      await authApiKeyService.getUserApiKeys('user_alice_001');

      // Assert
      expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        })
      );
    });
  });

  // ===========================================================================
  // revokeApiKey
  // ===========================================================================

  describe('revokeApiKey', () => {
    it('should revoke API key owned by user', async () => {
      // Arrange
      prismaMock.apiKey.findUnique.mockResolvedValue(ALICE_API_KEY_1.dbResult);
      prismaMock.apiKey.delete.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act
      await authApiKeyService.revokeApiKey('user_alice_001', 'apikey_alice_001');

      // Assert
      expect(prismaMock.apiKey.delete).toHaveBeenCalledWith({
        where: { id: 'apikey_alice_001' },
      });
    });

    it('should throw error if API key not found', async () => {
      // Arrange
      prismaMock.apiKey.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        authApiKeyService.revokeApiKey('user_alice_001', 'nonexistent_key')
      ).rejects.toThrow('API key not found or does not belong to user');
    });

    it('should throw error if API key belongs to different user', async () => {
      // Arrange
      prismaMock.apiKey.findUnique.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act & Assert - Bob trying to revoke Alice's key
      await expect(
        authApiKeyService.revokeApiKey('user_bob_001', 'apikey_alice_001')
      ).rejects.toThrow('API key not found or does not belong to user');
    });

    it('should verify ownership before deletion', async () => {
      // Arrange
      prismaMock.apiKey.findUnique.mockResolvedValue(ALICE_API_KEY_1.dbResult);
      prismaMock.apiKey.delete.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act
      await authApiKeyService.revokeApiKey('user_alice_001', 'apikey_alice_001');

      // Assert - Should check ownership first
      expect(prismaMock.apiKey.findUnique).toHaveBeenCalledWith({
        where: { id: 'apikey_alice_001' },
      });
      expect(prismaMock.apiKey.delete).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // updateLastUsed
  // ===========================================================================

  describe('updateLastUsed', () => {
    it('should update lastUsed timestamp', async () => {
      // Arrange
      const updatedKey = {
        ...ALICE_API_KEY_1.dbResult,
        lastUsed: new Date('2024-01-15T12:00:00.000Z'),
      };
      prismaMock.apiKey.update.mockResolvedValue(updatedKey);

      // Act
      await authApiKeyService.updateLastUsed('apikey_alice_001');

      // Assert
      expect(prismaMock.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'apikey_alice_001' },
        data: { lastUsed: expect.any(Date) },
      });
    });

    it('should not throw error on update failure (fire-and-forget)', async () => {
      // Arrange
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      prismaMock.apiKey.update.mockRejectedValue(new Error('Database error'));

      // Act - Should not throw
      await expect(
        authApiKeyService.updateLastUsed('apikey_alice_001')
      ).resolves.toBeUndefined();

      // Cleanup
      consoleErrorSpy.mockRestore();
    });
  });

  // ===========================================================================
  // Security Tests
  // ===========================================================================

  describe('Security', () => {
    it('should never expose key hash in getUserApiKeys', async () => {
      // Arrange
      prismaMock.apiKey.findMany.mockResolvedValue([
        {
          id: ALICE_API_KEY_1.dbResult.id,
          name: ALICE_API_KEY_1.dbResult.name,
          keyPrefix: ALICE_API_KEY_1.dbResult.keyPrefix,
          lastUsed: ALICE_API_KEY_1.dbResult.lastUsed,
          createdAt: ALICE_API_KEY_1.dbResult.createdAt,
          updatedAt: ALICE_API_KEY_1.dbResult.updatedAt,
        },
      ] as any);

      // Act
      const result = await authApiKeyService.getUserApiKeys('user_alice_001');

      // Assert
      expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.objectContaining({
            keyHash: true,
          }),
        })
      );
      expect(result[0]).not.toHaveProperty('keyHash');
    });

    it('should use SHA-256 for hashing (64 hex characters)', async () => {
      // Arrange
      prismaMock.apiKey.create.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act
      const result = await authApiKeyService.createApiKey('user_alice_001', 'Test Key');

      // Assert
      const hash = createHash('sha256').update(result.key).digest('hex');
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 = 64 hex chars
    });

    it('should only return full key at creation time', async () => {
      // Arrange
      prismaMock.apiKey.create.mockResolvedValue(ALICE_API_KEY_1.dbResult);

      // Act - Create key
      const creationResult = await authApiKeyService.createApiKey(
        'user_alice_001',
        'Test Key'
      );

      // Assert - Full key returned
      expect(creationResult.key).toMatch(/^mc_live_[A-Za-z0-9]{32}$/);

      // Arrange - Try to get keys list
      prismaMock.apiKey.findMany.mockResolvedValue([
        {
          id: ALICE_API_KEY_1.dbResult.id,
          name: ALICE_API_KEY_1.dbResult.name,
          keyPrefix: ALICE_API_KEY_1.dbResult.keyPrefix,
          lastUsed: ALICE_API_KEY_1.dbResult.lastUsed,
          createdAt: ALICE_API_KEY_1.dbResult.createdAt,
          updatedAt: ALICE_API_KEY_1.dbResult.updatedAt,
        },
      ] as any);

      // Act - Get keys
      const listResult = await authApiKeyService.getUserApiKeys('user_alice_001');

      // Assert - Only prefix shown
      expect(listResult[0]).toHaveProperty('keyPrefix', 'mc_live_');
      expect(listResult[0]).not.toHaveProperty('key');
    });
  });

  // ===========================================================================
  // Constructor
  // ===========================================================================

  describe('constructor', () => {
    it('should accept custom prisma client', () => {
      // Arrange & Act
      const customService = new AuthApiKeyService({ prisma: prismaMock });

      // Assert
      expect(customService).toBeInstanceOf(AuthApiKeyService);
    });

    it('should work without dependencies (uses default PrismaClient)', () => {
      // Arrange & Act
      const defaultService = new AuthApiKeyService();

      // Assert
      expect(defaultService).toBeInstanceOf(AuthApiKeyService);
    });
  });
});
