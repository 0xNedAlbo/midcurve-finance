/**
 * Unit tests for CacheService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@midcurve/database';
import { CacheService } from './cache-service.js';

describe('CacheService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let cacheService: CacheService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    cacheService = new CacheService({ prisma: prismaMock });
  });

  // ============================================================================
  // get() - Retrieve from cache
  // ============================================================================

  describe('get()', () => {
    it('should return null when key not found', async () => {
      prismaMock.cache.findUnique.mockResolvedValue(null);

      const result = await cacheService.get('nonexistent-key');

      expect(result).toBeNull();
      expect(prismaMock.cache.findUnique).toHaveBeenCalledWith({
        where: { key: 'nonexistent-key' },
      });
    });

    it('should return cached value when found and not expired', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600 * 1000); // 1 hour from now

      prismaMock.cache.findUnique.mockResolvedValue({
        key: 'test-key',
        value: { data: 'test-value' },
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      const result = await cacheService.get<{ data: string }>('test-key');

      expect(result).toEqual({ data: 'test-value' });
      expect(prismaMock.cache.findUnique).toHaveBeenCalledWith({
        where: { key: 'test-key' },
      });
    });

    it('should return null and delete entry when expired', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() - 1000); // 1 second ago (expired)

      prismaMock.cache.findUnique.mockResolvedValue({
        key: 'expired-key',
        value: { data: 'old-value' },
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      prismaMock.cache.delete.mockResolvedValue({
        key: 'expired-key',
        value: { data: 'old-value' },
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      const result = await cacheService.get('expired-key');

      expect(result).toBeNull();
      // Note: delete is fire-and-forget, so we can't reliably test it was called
    });

    it('should return null on database error', async () => {
      prismaMock.cache.findUnique.mockRejectedValue(new Error('Database connection failed'));

      const result = await cacheService.get('test-key');

      expect(result).toBeNull();
    });

    it('should handle complex JSON values', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600 * 1000);
      const complexValue = {
        tokens: [
          { id: '1', symbol: 'USDC', decimals: 6 },
          { id: '2', symbol: 'WETH', decimals: 18 },
        ],
        metadata: { total: 2, cached: true },
      };

      prismaMock.cache.findUnique.mockResolvedValue({
        key: 'complex-key',
        value: complexValue as any,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      const result = await cacheService.get<typeof complexValue>('complex-key');

      expect(result).toEqual(complexValue);
    });
  });

  // ============================================================================
  // set() - Store in cache
  // ============================================================================

  describe('set()', () => {
    it('should create new cache entry', async () => {
      const value = { data: 'test-value' };
      const ttlSeconds = 3600;

      prismaMock.cache.upsert.mockResolvedValue({
        key: 'new-key',
        value: value as any,
        expiresAt: expect.any(Date),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      const result = await cacheService.set('new-key', value, ttlSeconds);

      expect(result).toBe(true);
      expect(prismaMock.cache.upsert).toHaveBeenCalledWith({
        where: { key: 'new-key' },
        create: {
          key: 'new-key',
          value: value,
          expiresAt: expect.any(Date),
        },
        update: {
          value: value,
          expiresAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should update existing cache entry', async () => {
      const value = { data: 'updated-value' };
      const ttlSeconds = 1800;

      prismaMock.cache.upsert.mockResolvedValue({
        key: 'existing-key',
        value: value as any,
        expiresAt: expect.any(Date),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      const result = await cacheService.set('existing-key', value, ttlSeconds);

      expect(result).toBe(true);
    });

    it('should calculate correct expiration time', async () => {
      const value = { data: 'test' };
      const ttlSeconds = 7200; // 2 hours
      const beforeCall = Date.now();

      prismaMock.cache.upsert.mockImplementation(async (args) => {
        const expiresAt = args.create.expiresAt as Date;
        const afterCall = Date.now();
        const expectedExpiry = beforeCall + ttlSeconds * 1000;
        const actualExpiry = expiresAt.getTime();

        // Allow 1 second tolerance for test execution time
        expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry - 1000);
        expect(actualExpiry).toBeLessThanOrEqual(afterCall + ttlSeconds * 1000 + 1000);

        return {
          key: 'time-test',
          value: value as any,
          expiresAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      await cacheService.set('time-test', value, ttlSeconds);
    });

    it('should return false on database error', async () => {
      prismaMock.cache.upsert.mockRejectedValue(new Error('Database error'));

      const result = await cacheService.set('test-key', { data: 'test' }, 3600);

      expect(result).toBe(false);
    });

    it('should handle array values', async () => {
      const arrayValue = [1, 2, 3, 4, 5];

      prismaMock.cache.upsert.mockResolvedValue({
        key: 'array-key',
        value: arrayValue as any,
        expiresAt: expect.any(Date),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      const result = await cacheService.set('array-key', arrayValue, 3600);

      expect(result).toBe(true);
      expect(prismaMock.cache.upsert).toHaveBeenCalledWith({
        where: { key: 'array-key' },
        create: {
          key: 'array-key',
          value: arrayValue,
          expiresAt: expect.any(Date),
        },
        update: {
          value: arrayValue,
          expiresAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      });
    });
  });

  // ============================================================================
  // delete() - Remove from cache
  // ============================================================================

  describe('delete()', () => {
    it('should delete existing cache entry', async () => {
      prismaMock.cache.delete.mockResolvedValue({
        key: 'delete-key',
        value: { data: 'value' } as any,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await cacheService.delete('delete-key');

      expect(result).toBe(true);
      expect(prismaMock.cache.delete).toHaveBeenCalledWith({
        where: { key: 'delete-key' },
      });
    });

    it('should return true when key not found (P2025 error)', async () => {
      const error = new Error('Record not found');
      (error as any).code = 'P2025';

      prismaMock.cache.delete.mockRejectedValue(error);

      const result = await cacheService.delete('nonexistent-key');

      expect(result).toBe(true);
    });

    it('should return false on other database errors', async () => {
      prismaMock.cache.delete.mockRejectedValue(new Error('Database connection failed'));

      const result = await cacheService.delete('test-key');

      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // clear() - Bulk delete
  // ============================================================================

  describe('clear()', () => {
    it('should clear all cache entries when no pattern provided', async () => {
      prismaMock.cache.deleteMany.mockResolvedValue({ count: 42 });

      const result = await cacheService.clear();

      expect(result).toBe(42);
      expect(prismaMock.cache.deleteMany).toHaveBeenCalledWith({
        where: {},
      });
    });

    it('should clear cache entries matching pattern', async () => {
      prismaMock.cache.deleteMany.mockResolvedValue({ count: 5 });

      const result = await cacheService.clear('coingecko:%');

      expect(result).toBe(5);
      expect(prismaMock.cache.deleteMany).toHaveBeenCalledWith({
        where: {
          key: {
            startsWith: 'coingecko:',
          },
        },
      });
    });

    it('should return -1 on database error', async () => {
      prismaMock.cache.deleteMany.mockRejectedValue(new Error('Database error'));

      const result = await cacheService.clear();

      expect(result).toBe(-1);
    });
  });

  // ============================================================================
  // cleanup() - Remove expired entries
  // ============================================================================

  describe('cleanup()', () => {
    it('should delete expired cache entries', async () => {
      prismaMock.cache.deleteMany.mockResolvedValue({ count: 10 });

      const result = await cacheService.cleanup();

      expect(result).toBe(10);
      expect(prismaMock.cache.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it('should return -1 on database error', async () => {
      prismaMock.cache.deleteMany.mockRejectedValue(new Error('Database error'));

      const result = await cacheService.cleanup();

      expect(result).toBe(-1);
    });
  });

  // ============================================================================
  // getStats() - Cache statistics
  // ============================================================================

  describe('getStats()', () => {
    it('should return cache statistics', async () => {
      prismaMock.cache.count.mockResolvedValueOnce(100); // total
      prismaMock.cache.count.mockResolvedValueOnce(15); // expired

      const result = await cacheService.getStats();

      expect(result).toEqual({
        totalEntries: 100,
        expiredEntries: 15,
        activeEntries: 85,
      });
    });

    it('should return zeros on database error', async () => {
      prismaMock.cache.count.mockRejectedValue(new Error('Database error'));

      const result = await cacheService.getStats();

      expect(result).toEqual({
        totalEntries: 0,
        expiredEntries: 0,
        activeEntries: 0,
      });
    });
  });

  // ============================================================================
  // Singleton Pattern
  // ============================================================================

  describe('Singleton Pattern', () => {
    it('should return same instance across getInstance() calls', () => {
      CacheService.resetInstance();

      const instance1 = CacheService.getInstance();
      const instance2 = CacheService.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      CacheService.resetInstance();
      const instance1 = CacheService.getInstance();

      CacheService.resetInstance();
      const instance2 = CacheService.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });
});
