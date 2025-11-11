/**
 * Comprehensive tests for abstract TokenService
 * Tests base CRUD operations with a concrete test implementation
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@midcurve/database';
import { TokenService } from './token-service.js';
import type { Erc20TokenConfig } from '@midcurve/shared';
import type {
  CreateTokenInput,
  UpdateTokenInput,
  TokenDiscoverInput,
} from '../types/token/token-input.js';
import type { Token } from '@midcurve/shared';
import {
  USDC_ETHEREUM,
  WETH_ETHEREUM,
  DAI_ETHEREUM,
  MINIMAL_ERC20,
  createTokenFixture,
} from './test-fixtures.js';

/**
 * Concrete test implementation of TokenService for testing abstract methods
 * Uses 'erc20' as the token type for simplicity
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

  async discover(
    params: TokenDiscoverInput<'erc20'>
  ): Promise<Token<'erc20'>> {
    // Simple test implementation - creates a token with the params
    return this.create({
      tokenType: 'erc20',
      name: 'Discovered Token',
      symbol: 'DISC',
      decimals: 18,
      config: params,
    });
  }
}

describe('TokenService (Abstract Base)', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let tokenService: TestTokenService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    tokenService = new TestTokenService({
      prisma: prismaMock as unknown as PrismaClient,
    });
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with provided Prisma client', () => {
      const service = new TestTokenService({
        prisma: prismaMock as unknown as PrismaClient,
      });
      expect(service).toBeInstanceOf(TestTokenService);
      expect(service).toBeInstanceOf(TokenService);
    });

    it('should create instance with default Prisma client when not provided', () => {
      const service = new TestTokenService();
      expect(service).toBeInstanceOf(TestTokenService);
    });

    it('should accept empty dependencies object', () => {
      const service = new TestTokenService({});
      expect(service).toBeInstanceOf(TestTokenService);
    });
  });

  // ==========================================================================
  // findById Method Tests
  // ==========================================================================

  describe('findById', () => {
    it('should find existing token by id', async () => {
      prismaMock.token.findUnique.mockResolvedValue(USDC_ETHEREUM.dbResult);

      const result = await tokenService.findById('token_usdc_eth_001');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('token_usdc_eth_001');
      expect(result?.symbol).toBe('USDC');
      expect(result?.tokenType).toBe('erc20');
    });

    it('should return null when token not found', async () => {
      prismaMock.token.findUnique.mockResolvedValue(null);

      const result = await tokenService.findById('nonexistent_token');

      expect(result).toBeNull();
    });

    it('should convert null optional fields to undefined', async () => {
      const mockToken = {
        ...MINIMAL_ERC20.dbResult,
        logoUrl: null,
        coingeckoId: null,
        marketCap: null,
      };

      prismaMock.token.findUnique.mockResolvedValue(mockToken);

      const result = await tokenService.findById('token_002');

      expect(result?.logoUrl).toBeUndefined();
      expect(result?.coingeckoId).toBeUndefined();
      expect(result?.marketCap).toBeUndefined();
    });
  });

  // ==========================================================================
  // create Method Tests
  // ==========================================================================

  describe('create', () => {
    it('should create token with all fields', async () => {
      prismaMock.token.create.mockResolvedValue(USDC_ETHEREUM.dbResult);

      const result = await tokenService.create(USDC_ETHEREUM.input);

      expect(result.id).toBe('token_usdc_eth_001');
      expect(result.symbol).toBe('USDC');
      expect(result.decimals).toBe(6);
      expect(result.logoUrl).toBe('https://example.com/usdc.png');
    });

    it('should create token with only required fields', async () => {
      prismaMock.token.create.mockResolvedValue(MINIMAL_ERC20.dbResult);

      const result = await tokenService.create(MINIMAL_ERC20.input);

      expect(result.name).toBe('Minimal Token');
      expect(result.logoUrl).toBeUndefined();
    });

    it('should call Prisma create exactly once', async () => {
      prismaMock.token.create.mockResolvedValue(USDC_ETHEREUM.dbResult);

      await tokenService.create(USDC_ETHEREUM.input);

      expect(prismaMock.token.create).toHaveBeenCalledTimes(1);
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Unique constraint failed');
      prismaMock.token.create.mockRejectedValue(dbError);

      await expect(tokenService.create(USDC_ETHEREUM.input)).rejects.toThrow(
        'Unique constraint failed'
      );
    });
  });

  // ==========================================================================
  // update Method Tests
  // ==========================================================================

  describe('update', () => {
    it('should update token fields', async () => {
      prismaMock.token.findUnique.mockResolvedValue(USDC_ETHEREUM.dbResult);

      const updatedToken = {
        ...USDC_ETHEREUM.dbResult,
        name: 'New Name',
      };

      prismaMock.token.update.mockResolvedValue(updatedToken);

      const result = await tokenService.update('token_usdc_eth_001', {
        name: 'New Name',
      });

      expect(result.name).toBe('New Name');
    });

    it('should throw error when token not found', async () => {
      prismaMock.token.findUnique.mockResolvedValue(null);

      await expect(
        tokenService.update('nonexistent_token', { name: 'New Name' })
      ).rejects.toThrow('Token with id nonexistent_token not found');
    });
  });

  // ==========================================================================
  // delete Method Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete existing token', async () => {
      prismaMock.token.findUnique.mockResolvedValue(USDC_ETHEREUM.dbResult);
      prismaMock.token.delete.mockResolvedValue(USDC_ETHEREUM.dbResult);

      await tokenService.delete('token_usdc_eth_001');

      expect(prismaMock.token.delete).toHaveBeenCalledWith({
        where: { id: 'token_usdc_eth_001' },
      });
    });

    it('should be idempotent - silently return when token not found', async () => {
      prismaMock.token.findUnique.mockResolvedValue(null);

      // Should not throw error
      await expect(tokenService.delete('nonexistent_token')).resolves.toBeUndefined();

      // Should not call prisma.token.delete
      expect(prismaMock.token.delete).not.toHaveBeenCalled();
    });

    it('should be idempotent - allow multiple deletes without error', async () => {
      // First call finds token
      prismaMock.token.findUnique.mockResolvedValueOnce(USDC_ETHEREUM.dbResult);
      prismaMock.token.delete.mockResolvedValue(USDC_ETHEREUM.dbResult);

      await tokenService.delete('token_usdc_eth_001');

      // Second call doesn't find token (already deleted)
      prismaMock.token.findUnique.mockResolvedValueOnce(null);

      // Should still succeed without error
      await expect(tokenService.delete('token_usdc_eth_001')).resolves.toBeUndefined();
    });
  });
});
