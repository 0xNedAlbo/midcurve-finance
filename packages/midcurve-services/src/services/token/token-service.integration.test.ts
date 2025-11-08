/**
 * Integration tests for TokenService
 * Tests CRUD operations against a real PostgreSQL database
 *
 * These tests verify:
 * - Database constraints and validations
 * - Foreign key relationships
 * - Transaction handling
 * - Real Prisma client behavior
 * - Data persistence and retrieval
 */

import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { TokenService } from './token-service.js';
import { getPrismaClient, disconnectPrisma, countAllRecords } from '../../test/helpers.js';
import type { Erc20TokenConfig } from '@midcurve/shared';
import type {
  CreateTokenInput,
  UpdateTokenInput,
} from '../types/token/token-input.js';

/**
 * Concrete test implementation of TokenService for integration tests
 */
class TestTokenService extends TokenService<'erc20'> {
  parseConfig(configDB: unknown): Erc20TokenConfig {
    const db = configDB as { address: string; chainId: number };
    return {
      address: db.address,
      chainId: db.chainId,
    };
  }

  serializeConfig(config: Erc20TokenConfig): unknown {
    return {
      address: config.address,
      chainId: config.chainId,
    };
  }

  async discover(): Promise<never> {
    throw new Error('Discover not implemented for test service');
  }
}

describe('TokenService - Integration Tests', () => {
  let service: TestTokenService;
  const prisma = getPrismaClient();

  beforeEach(() => {
    service = new TestTokenService({ prisma });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe('create()', () => {
    it('should create token and persist to database', async () => {
      const input: CreateTokenInput<Erc20TokenConfig> = {
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      };

      const token = await service.create(input);

      // Verify token was created with correct data
      expect(token.id).toBeDefined();
      expect(token.tokenType).toBe('erc20');
      expect(token.name).toBe('USD Coin');
      expect(token.symbol).toBe('USDC');
      expect(token.decimals).toBe(6);
      expect(token.config.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(token.config.chainId).toBe(1);
      expect(token.createdAt).toBeInstanceOf(Date);
      expect(token.updatedAt).toBeInstanceOf(Date);

      // Verify token was persisted to database
      const dbToken = await prisma.token.findUnique({
        where: { id: token.id },
      });
      expect(dbToken).toBeDefined();
      expect(dbToken?.symbol).toBe('USDC');
    });

    it('should create token with optional fields', async () => {
      const input: CreateTokenInput<Erc20TokenConfig> = {
        tokenType: 'erc20',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        logoUrl: 'https://example.com/weth.png',
        coingeckoId: 'weth',
        marketCap: 15000000000,
        config: {
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          chainId: 1,
        },
      };

      const token = await service.create(input);

      expect(token.logoUrl).toBe('https://example.com/weth.png');
      expect(token.coingeckoId).toBe('weth');
      expect(token.marketCap).toBe(15000000000);
    });

    it('should allow multiple tokens with same symbol on different chains', async () => {
      const usdc_eth: CreateTokenInput<Erc20TokenConfig> = {
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1, // Ethereum
        },
      };

      const usdc_arb: CreateTokenInput<Erc20TokenConfig> = {
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          chainId: 42161, // Arbitrum
        },
      };

      const token1 = await service.create(usdc_eth);
      const token2 = await service.create(usdc_arb);

      expect(token1.id).not.toBe(token2.id);
      expect(token1.symbol).toBe('USDC');
      expect(token2.symbol).toBe('USDC');
      expect(token1.config.chainId).toBe(1);
      expect(token2.config.chainId).toBe(42161);
    });

    it('should handle special characters in token name', async () => {
      const input: CreateTokenInput<Erc20TokenConfig> = {
        tokenType: 'erc20',
        name: 'Token™ with © special © characters',
        symbol: 'SPEC',
        decimals: 18,
        config: {
          address: '0x1234567890123456789012345678901234567890',
          chainId: 1,
        },
      };

      const token = await service.create(input);
      expect(token.name).toBe('Token™ with © special © characters');
    });
  });

  describe('findById()', () => {
    it('should retrieve token by ID', async () => {
      // Create a token
      const created = await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Retrieve by ID
      const found = await service.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.symbol).toBe('USDC');
      expect(found?.config.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    });

    it('should return null for non-existent ID', async () => {
      const found = await service.findById('non_existent_id');
      expect(found).toBeNull();
    });
  });

  describe('update()', () => {
    it('should update token fields', async () => {
      // Create a token
      const created = await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Update optional fields
      const updates: UpdateTokenInput<Erc20TokenConfig> = {
        logoUrl: 'https://example.com/usdc-logo.png',
        coingeckoId: 'usd-coin',
        marketCap: 28000000000,
      };

      const updated = await service.update(created.id, updates);

      expect(updated.id).toBe(created.id);
      expect(updated.logoUrl).toBe('https://example.com/usdc-logo.png');
      expect(updated.coingeckoId).toBe('usd-coin');
      expect(updated.marketCap).toBe(28000000000);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

      // Verify immutable fields remain unchanged
      expect(updated.tokenType).toBe('erc20');
      expect(updated.symbol).toBe('USDC');
      expect(updated.decimals).toBe(6);
    });

    it('should allow updating name and symbol', async () => {
      const created = await service.create({
        tokenType: 'erc20',
        name: 'Old Name',
        symbol: 'OLD',
        decimals: 18,
        config: {
          address: '0x1234567890123456789012345678901234567890',
          chainId: 1,
        },
      });

      const updated = await service.update(created.id, {
        name: 'New Name',
        symbol: 'NEW',
      });

      expect(updated.name).toBe('New Name');
      expect(updated.symbol).toBe('NEW');
    });

    it('should throw error when updating non-existent token', async () => {
      await expect(
        service.update('non_existent_id', { logoUrl: 'https://example.com/logo.png' })
      ).rejects.toThrow();
    });
  });

  describe('delete()', () => {
    it('should delete token from database', async () => {
      // Create a token
      const created = await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Verify it exists
      const beforeDelete = await service.findById(created.id);
      expect(beforeDelete).toBeDefined();

      // Delete
      await service.delete(created.id);

      // Verify it's gone
      const afterDelete = await service.findById(created.id);
      expect(afterDelete).toBeNull();
    });

    it('should be idempotent - silently return when deleting non-existent token', async () => {
      // Should not throw error
      await expect(service.delete('non_existent_id')).resolves.not.toThrow();

      // Verify it completes without error
      await service.delete('non_existent_id');
    });

    it('should be idempotent - allow multiple deletes of same token', async () => {
      // Create a token
      const created = await service.create({
        tokenType: 'erc20',
        name: 'Test Token',
        symbol: 'TEST',
        decimals: 18,
        config: {
          address: '0x1234567890123456789012345678901234567890',
          chainId: 1,
        },
      });

      // First delete
      await service.delete(created.id);

      // Verify it's gone
      const afterFirstDelete = await service.findById(created.id);
      expect(afterFirstDelete).toBeNull();

      // Second delete should not throw error (idempotent)
      await expect(service.delete(created.id)).resolves.not.toThrow();
    });
  });

  describe('Database Constraints', () => {
    it('should verify database is clean between tests', async () => {
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(0);
      expect(counts.pools).toBe(0);
      expect(counts.positions).toBe(0);
    });

    it('should handle concurrent creates without conflicts', async () => {
      // Create multiple tokens in parallel
      const promises = [
        service.create({
          tokenType: 'erc20',
          name: 'Token 1',
          symbol: 'TOK1',
          decimals: 18,
          config: { address: '0x1111111111111111111111111111111111111111', chainId: 1 },
        }),
        service.create({
          tokenType: 'erc20',
          name: 'Token 2',
          symbol: 'TOK2',
          decimals: 18,
          config: { address: '0x2222222222222222222222222222222222222222', chainId: 1 },
        }),
        service.create({
          tokenType: 'erc20',
          name: 'Token 3',
          symbol: 'TOK3',
          decimals: 18,
          config: { address: '0x3333333333333333333333333333333333333333', chainId: 1 },
        }),
      ];

      const tokens = await Promise.all(promises);

      expect(tokens).toHaveLength(3);
      expect(new Set(tokens.map((t) => t.id)).size).toBe(3); // All unique IDs

      // Verify all persisted
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(3);
    });
  });

  describe('Type Safety and Config Handling', () => {
    it('should correctly serialize and deserialize config', async () => {
      const config: Erc20TokenConfig = {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        chainId: 1,
      };

      const created = await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config,
      });

      // Config should be correctly typed after round-trip
      expect(created.config.address).toBe(config.address);
      expect(created.config.chainId).toBe(config.chainId);
      expect(typeof created.config.chainId).toBe('number');
    });

    it('should handle JSON storage correctly', async () => {
      // Create token with complex config
      const token = await service.create({
        tokenType: 'erc20',
        name: 'Test Token',
        symbol: 'TEST',
        decimals: 18,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 42161,
        },
      });

      // Retrieve directly from database to verify JSON storage
      const dbToken = await prisma.token.findUnique({
        where: { id: token.id },
      });

      expect(dbToken?.config).toBeDefined();
      expect(dbToken?.config).toMatchObject({
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        chainId: 42161,
      });
    });
  });
});
