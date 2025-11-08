/**
 * Integration tests for Erc20TokenService
 * Tests ERC-20 specific functionality against real PostgreSQL database
 *
 * These tests verify:
 * - Address normalization and validation (EIP-55)
 * - Duplicate prevention by address + chainId
 * - Type filtering (ERC-20 vs other token types)
 * - JSON path queries for config fields
 * - Multi-chain token support
 * - Selective idempotent delete operations
 */

import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { Erc20TokenService } from './erc20-token-service.js';
import {
  getPrismaClient,
  disconnectPrisma,
  countAllRecords,
} from '../../test/helpers.js';
import type { CreateTokenInput } from '../types/token/token-input.js';

describe('Erc20TokenService - Integration Tests', () => {
  let service: Erc20TokenService;
  const prisma = getPrismaClient();

  beforeEach(() => {
    service = new Erc20TokenService({ prisma });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  // ==========================================================================
  // create() Tests
  // ==========================================================================

  describe('create()', () => {
    it('should create new token with valid data', async () => {
      const input: CreateTokenInput<'erc20'> = {
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

      // Verify token was created
      expect(token.id).toBeDefined();
      expect(token.tokenType).toBe('erc20');
      expect(token.name).toBe('USD Coin');
      expect(token.symbol).toBe('USDC');
      expect(token.decimals).toBe(6);
      expect(token.config.address).toBe(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      );
      expect(token.config.chainId).toBe(1);

      // Verify persisted to database
      const dbToken = await prisma.token.findUnique({
        where: { id: token.id },
      });
      expect(dbToken).toBeDefined();
      expect(dbToken?.symbol).toBe('USDC');
    });

    it('should return existing token on duplicate (same address + chainId)', async () => {
      const input: CreateTokenInput<'erc20'> = {
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      };

      // First create
      const token1 = await service.create(input);

      // Second create with same address + chainId
      const token2 = await service.create({
        ...input,
        name: 'Different Name', // Different data
      });

      // Should return same token
      expect(token1.id).toBe(token2.id);

      // Verify only one token in database
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(1);
    });

    it('should normalize lowercase address to EIP-55', async () => {
      const input: CreateTokenInput<'erc20'> = {
        tokenType: 'erc20',
        name: 'Test Token',
        symbol: 'TEST',
        decimals: 18,
        config: {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // lowercase
          chainId: 1,
        },
      };

      const token = await service.create(input);

      // Verify address was normalized
      expect(token.config.address).toBe(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      );

      // Verify normalized in database
      const dbToken = await prisma.token.findUnique({
        where: { id: token.id },
      });
      const config = dbToken?.config as { address: string; chainId: number };
      expect(config.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    });

    it('should normalize mixed-case address to EIP-55', async () => {
      const input: CreateTokenInput<'erc20'> = {
        tokenType: 'erc20',
        name: 'Test Token',
        symbol: 'TEST',
        decimals: 18,
        config: {
          address: '0xa0B86991c6218b36c1d19d4A2e9Eb0cE3606eB48', // mixed case (incorrect)
          chainId: 1,
        },
      };

      const token = await service.create(input);

      // Verify address was normalized to proper EIP-55
      expect(token.config.address).toBe(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      );
    });

    it('should allow same address on different chains', async () => {
      const addressUSDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      // Create USDC on Ethereum
      const tokenEth = await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: addressUSDC,
          chainId: 1, // Ethereum
        },
      });

      // Create USDC on Arbitrum (same address)
      const tokenArb = await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: addressUSDC,
          chainId: 42161, // Arbitrum
        },
      });

      // Should be different tokens
      expect(tokenEth.id).not.toBe(tokenArb.id);
      expect(tokenEth.config.chainId).toBe(1);
      expect(tokenArb.config.chainId).toBe(42161);

      // Verify both in database
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(2);
    });

    it('should throw error for invalid address format', async () => {
      const input: CreateTokenInput<'erc20'> = {
        tokenType: 'erc20',
        name: 'Invalid Token',
        symbol: 'INV',
        decimals: 18,
        config: {
          address: 'invalid-address',
          chainId: 1,
        },
      };

      await expect(service.create(input)).rejects.toThrow(
        'Invalid Ethereum address format'
      );

      // Verify no token created
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(0);
    });

    it('should throw error for too-short address', async () => {
      const input: CreateTokenInput<'erc20'> = {
        tokenType: 'erc20',
        name: 'Invalid Token',
        symbol: 'INV',
        decimals: 18,
        config: {
          address: '0x123',
          chainId: 1,
        },
      };

      await expect(service.create(input)).rejects.toThrow(
        'Invalid Ethereum address format'
      );
    });
  });

  // ==========================================================================
  // findById() Tests
  // ==========================================================================

  describe('findById()', () => {
    it('should find existing ERC-20 token', async () => {
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

      // Find by ID
      const found = await service.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.symbol).toBe('USDC');
      expect(found?.tokenType).toBe('erc20');
    });

    it('should return null for non-existent ID', async () => {
      const found = await service.findById('non_existent_id');
      expect(found).toBeNull();
    });

    it('should return null when token exists but is NOT ERC-20', async () => {
      // Create a non-ERC-20 token directly in database
      const solanaToken = await prisma.token.create({
        data: {
          tokenType: 'solana-spl',
          name: 'Wrapped SOL',
          symbol: 'SOL',
          decimals: 9,
          config: {
            mint: 'So11111111111111111111111111111111111111112',
          },
        },
      });

      // Try to find with Erc20TokenService - should return null (type filter)
      const found = await service.findById(solanaToken.id);
      expect(found).toBeNull();
    });
  });

  // ==========================================================================
  // findByAddressAndChain() Tests
  // ==========================================================================

  describe('findByAddressAndChain()', () => {
    it('should find token with exact address match', async () => {
      // Create a token
      await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Find by exact address
      const found = await service.findByAddressAndChain(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        1
      );

      expect(found).not.toBeNull();
      expect(found?.symbol).toBe('USDC');
    });

    it('should find token with lowercase address (normalization)', async () => {
      // Create a token
      await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Query with lowercase address
      const found = await service.findByAddressAndChain(
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // lowercase
        1
      );

      expect(found).not.toBeNull();
      expect(found?.symbol).toBe('USDC');
    });

    it('should find token with mixed-case address (normalization)', async () => {
      // Create a token
      await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Query with mixed case (incorrect checksum)
      const found = await service.findByAddressAndChain(
        '0xa0B86991c6218b36c1d19d4A2e9Eb0cE3606eB48',
        1
      );

      expect(found).not.toBeNull();
      expect(found?.symbol).toBe('USDC');
    });

    it('should return null when not found', async () => {
      const found = await service.findByAddressAndChain(
        '0x0000000000000000000000000000000000000000',
        1
      );

      expect(found).toBeNull();
    });

    it('should distinguish between different chains', async () => {
      const address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      // Create USDC on Ethereum
      await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address,
          chainId: 1,
        },
      });

      // Create USDC on Arbitrum
      await service.create({
        tokenType: 'erc20',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        config: {
          address,
          chainId: 42161,
        },
      });

      // Find on Ethereum
      const foundEth = await service.findByAddressAndChain(address, 1);
      expect(foundEth).not.toBeNull();
      expect(foundEth?.config.chainId).toBe(1);

      // Find on Arbitrum
      const foundArb = await service.findByAddressAndChain(address, 42161);
      expect(foundArb).not.toBeNull();
      expect(foundArb?.config.chainId).toBe(42161);

      // Should be different tokens
      expect(foundEth?.id).not.toBe(foundArb?.id);
    });
  });

  // ==========================================================================
  // update() Tests
  // ==========================================================================

  describe('update()', () => {
    it('should update optional fields', async () => {
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
      const updated = await service.update(created.id, {
        logoUrl: 'https://example.com/usdc.png',
        coingeckoId: 'usd-coin',
        marketCap: 28000000000,
      });

      expect(updated.logoUrl).toBe('https://example.com/usdc.png');
      expect(updated.coingeckoId).toBe('usd-coin');
      expect(updated.marketCap).toBe(28000000000);

      // Verify in database
      const dbToken = await prisma.token.findUnique({
        where: { id: created.id },
      });
      expect(dbToken?.logoUrl).toBe('https://example.com/usdc.png');
    });

    it('should update address with normalization', async () => {
      // Create a token
      const created = await service.create({
        tokenType: 'erc20',
        name: 'Test Token',
        symbol: 'TEST',
        decimals: 18,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Update with lowercase address
      const updated = await service.update(created.id, {
        config: {
          address: '0xdac17f958d2ee523a2206206994597c13d831ec7', // lowercase
          chainId: 1,
        },
      });

      // Verify address was normalized
      expect(updated.config.address).toBe(
        '0xdAC17F958D2ee523a2206206994597C13D831ec7'
      );
    });

    it('should throw error when token not found', async () => {
      await expect(
        service.update('non_existent_id', {
          logoUrl: 'https://example.com/logo.png',
        })
      ).rejects.toThrow('Token with id non_existent_id not found');
    });

    it('should throw error when token is not ERC-20', async () => {
      // Create a non-ERC-20 token
      const solanaToken = await prisma.token.create({
        data: {
          tokenType: 'solana-spl',
          name: 'Wrapped SOL',
          symbol: 'SOL',
          decimals: 9,
          config: {
            mint: 'So11111111111111111111111111111111111111112',
          },
        },
      });

      // Try to update with Erc20TokenService
      await expect(
        service.update(solanaToken.id, {
          logoUrl: 'https://example.com/sol.png',
        })
      ).rejects.toThrow('is not an ERC-20 token');
    });
  });

  // ==========================================================================
  // delete() Tests
  // ==========================================================================

  describe('delete()', () => {
    it('should delete existing ERC-20 token', async () => {
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

      // Delete
      await service.delete(created.id);

      // Verify deleted
      const found = await service.findById(created.id);
      expect(found).toBeNull();

      // Verify removed from database
      const dbToken = await prisma.token.findUnique({
        where: { id: created.id },
      });
      expect(dbToken).toBeNull();
    });

    it('should be idempotent - silently return for non-existent token', async () => {
      // Should not throw error
      await expect(
        service.delete('non_existent_id')
      ).resolves.not.toThrow();
    });

    it('should throw error when token is not ERC-20 (type safety)', async () => {
      // Create a non-ERC-20 token
      const solanaToken = await prisma.token.create({
        data: {
          tokenType: 'solana-spl',
          name: 'Wrapped SOL',
          symbol: 'SOL',
          decimals: 9,
          config: {
            mint: 'So11111111111111111111111111111111111111112',
          },
        },
      });

      // Try to delete with Erc20TokenService
      await expect(service.delete(solanaToken.id)).rejects.toThrow(
        'is not an ERC-20 token'
      );

      // Verify token still exists
      const dbToken = await prisma.token.findUnique({
        where: { id: solanaToken.id },
      });
      expect(dbToken).not.toBeNull();
    });

    it('should allow multiple deletes of same token without error', async () => {
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

      // First delete
      await service.delete(created.id);

      // Second delete - should not throw
      await expect(service.delete(created.id)).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // Database Constraints Tests
  // ==========================================================================

  describe('Database Constraints', () => {
    it('should verify JSON path queries work (address + chainId)', async () => {
      const address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      // Create tokens on different chains
      await service.create({
        tokenType: 'erc20',
        name: 'USDC Ethereum',
        symbol: 'USDC',
        decimals: 6,
        config: { address, chainId: 1 },
      });

      await service.create({
        tokenType: 'erc20',
        name: 'USDC Arbitrum',
        symbol: 'USDC',
        decimals: 6,
        config: { address, chainId: 42161 },
      });

      // Query by address and chainId using JSON path
      const foundEth = await service.findByAddressAndChain(address, 1);
      const foundArb = await service.findByAddressAndChain(address, 42161);

      expect(foundEth?.config.chainId).toBe(1);
      expect(foundArb?.config.chainId).toBe(42161);
      expect(foundEth?.id).not.toBe(foundArb?.id);
    });

    it('should verify address normalization persisted correctly', async () => {
      // Create with lowercase
      const token = await service.create({
        tokenType: 'erc20',
        name: 'Test Token',
        symbol: 'TEST',
        decimals: 18,
        config: {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // lowercase
          chainId: 1,
        },
      });

      // Query directly from database
      const dbToken = await prisma.token.findUnique({
        where: { id: token.id },
      });

      const config = dbToken?.config as { address: string; chainId: number };

      // Verify normalized in database
      expect(config.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    });

    it('should handle concurrent creates without conflicts', async () => {
      // Create multiple tokens in parallel
      const promises = [
        service.create({
          tokenType: 'erc20',
          name: 'Token 1',
          symbol: 'TOK1',
          decimals: 18,
          config: {
            address: '0x1111111111111111111111111111111111111111',
            chainId: 1,
          },
        }),
        service.create({
          tokenType: 'erc20',
          name: 'Token 2',
          symbol: 'TOK2',
          decimals: 18,
          config: {
            address: '0x2222222222222222222222222222222222222222',
            chainId: 1,
          },
        }),
        service.create({
          tokenType: 'erc20',
          name: 'Token 3',
          symbol: 'TOK3',
          decimals: 18,
          config: {
            address: '0x3333333333333333333333333333333333333333',
            chainId: 1,
          },
        }),
      ];

      const tokens = await Promise.all(promises);

      expect(tokens).toHaveLength(3);
      expect(new Set(tokens.map((t) => t.id)).size).toBe(3); // All unique

      // Verify all persisted
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(3);
    });

    it('should verify database cleanup between tests', async () => {
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(0);
      expect(counts.pools).toBe(0);
      expect(counts.positions).toBe(0);
    });
  });
});
