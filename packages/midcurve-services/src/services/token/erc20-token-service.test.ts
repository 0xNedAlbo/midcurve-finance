/**
 * Tests for Erc20TokenService
 * Focused on ERC-20 specific functionality including token discovery
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@midcurve/database';
import type { PublicClient } from 'viem';
import { Erc20TokenService } from './erc20-token-service.js';
import { EvmConfig } from '../../config/evm.js';
import { TokenMetadataError } from '../../utils/evm/index.js';
import {
  USDC_ETHEREUM,
  DISCOVERED_TOKEN,
  NON_COMPLIANT_TOKEN,
} from './test-fixtures.js';

describe('Erc20TokenService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let evmConfigMock: DeepMockProxy<EvmConfig>;
  let publicClientMock: DeepMockProxy<PublicClient>;
  let coinGeckoClientMock: any;
  let service: Erc20TokenService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    evmConfigMock = mockDeep<EvmConfig>();
    publicClientMock = mockDeep<PublicClient>();
    coinGeckoClientMock = {
      getErc20EnrichmentData: vi.fn(),
      searchTokens: vi.fn(),
    };

    service = new Erc20TokenService({
      prisma: prismaMock as unknown as PrismaClient,
      evmConfig: evmConfigMock as unknown as EvmConfig,
      coinGeckoClient: coinGeckoClientMock,
    });
  });

  // ==========================================================================
  // Create Tests
  // ==========================================================================

  describe('create', () => {
    describe('successful creation', () => {
      it('should create new token with valid data', async () => {
        const { input, dbResult } = USDC_ETHEREUM;

        // Mock: Token doesn't exist (duplicate check)
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Token creation
        prismaMock.token.create.mockResolvedValue(dbResult);

        // Execute
        const result = await service.create(input);

        // Verify
        expect(result.name).toBe('USD Coin');
        expect(result.symbol).toBe('USDC');
        expect(result.decimals).toBe(6);
        expect(result.config.address).toBe(
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        );
        expect(result.config.chainId).toBe(1);

        // Verify duplicate check was performed
        expect(prismaMock.token.findFirst).toHaveBeenCalledTimes(1);

        // Verify token was created
        expect(prismaMock.token.create).toHaveBeenCalledTimes(1);
      });

      it('should return existing token when duplicate found', async () => {
        const { input, dbResult } = USDC_ETHEREUM;

        // Mock: Token already exists
        prismaMock.token.findFirst.mockResolvedValue(dbResult);

        // Execute
        const result = await service.create(input);

        // Verify
        expect(result.id).toBe(dbResult.id);
        expect(result.symbol).toBe('USDC');

        // Verify duplicate check was performed
        expect(prismaMock.token.findFirst).toHaveBeenCalledTimes(1);

        // Verify no new token was created
        expect(prismaMock.token.create).not.toHaveBeenCalled();
      });

      it('should normalize lowercase address', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          config: {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // lowercase
            chainId: 1,
          },
        };

        // Mock: No duplicate
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Creation
        prismaMock.token.create.mockResolvedValue({
          id: 'token_test',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
          config: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // normalized
            chainId: 1,
          },
        });

        // Execute
        const result = await service.create(input);

        // Verify address was normalized
        expect(result.config.address).toBe(
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        );
      });

      it('should normalize mixed case address', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          config: {
            address: '0xa0B86991c6218b36c1d19d4A2e9Eb0cE3606eB48', // mixed case (not proper checksum)
            chainId: 1,
          },
        };

        // Mock: No duplicate
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Creation
        prismaMock.token.create.mockResolvedValue({
          id: 'token_test',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
          config: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // normalized
            chainId: 1,
          },
        });

        // Execute
        const result = await service.create(input);

        // Verify address was normalized
        expect(result.config.address).toBe(
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        );
      });

      it('should handle optional fields', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'Test Token',
          symbol: 'TEST',
          decimals: 18,
          logoUrl: 'https://example.com/logo.png',
          coingeckoId: 'test-token',
          marketCap: 1000000,
          config: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            chainId: 1,
          },
        };

        // Mock: No duplicate
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Creation
        prismaMock.token.create.mockResolvedValue({
          id: 'token_test',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: input.logoUrl,
          coingeckoId: input.coingeckoId,
          marketCap: input.marketCap,
          config: input.config,
        });

        // Execute
        const result = await service.create(input);

        // Verify optional fields
        expect(result.logoUrl).toBe('https://example.com/logo.png');
        expect(result.coingeckoId).toBe('test-token');
        expect(result.marketCap).toBe(1000000);
      });

      it('should allow same address on different chains', async () => {
        const inputEth = {
          tokenType: 'erc20' as const,
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
          config: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            chainId: 1, // Ethereum
          },
        };

        const inputArb = {
          ...inputEth,
          config: {
            ...inputEth.config,
            chainId: 42161, // Arbitrum
          },
        };

        // Mock: No duplicate for Arbitrum (even though Ethereum exists)
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Creation
        prismaMock.token.create.mockResolvedValue({
          id: 'token_usdc_arb',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: inputArb.name,
          symbol: inputArb.symbol,
          decimals: inputArb.decimals,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
          config: inputArb.config,
        });

        // Execute
        const result = await service.create(inputArb);

        // Verify different chain allowed
        expect(result.config.chainId).toBe(42161);
      });

      it('should handle tokens with special characters', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'Token 中文 🚀',
          symbol: '$MEME',
          decimals: 18,
          config: {
            address: '0x8888888888888888888888888888888888888888',
            chainId: 1,
          },
        };

        // Mock: No duplicate
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Creation
        prismaMock.token.create.mockResolvedValue({
          id: 'token_special',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
          config: input.config,
        });

        // Execute
        const result = await service.create(input);

        // Verify special characters preserved
        expect(result.name).toBe('Token 中文 🚀');
        expect(result.symbol).toBe('$MEME');
      });
    });

    describe('validation errors', () => {
      it('should throw error for invalid address format', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'Test',
          symbol: 'TEST',
          decimals: 18,
          config: {
            address: 'invalid-address',
            chainId: 1,
          },
        };

        await expect(service.create(input)).rejects.toThrow(
          'Invalid Ethereum address format'
        );

        // Should fail before DB operations
        expect(prismaMock.token.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.token.create).not.toHaveBeenCalled();
      });

      it('should throw error for too short address', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'Test',
          symbol: 'TEST',
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

      it('should throw error for address without 0x prefix', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'Test',
          symbol: 'TEST',
          decimals: 18,
          config: {
            address: 'A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            chainId: 1,
          },
        };

        await expect(service.create(input)).rejects.toThrow(
          'Invalid Ethereum address format'
        );
      });
    });

    describe('edge cases', () => {
      it('should handle zero decimals', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'Zero Decimals',
          symbol: 'ZERO',
          decimals: 0,
          config: {
            address: '0xcccccccccccccccccccccccccccccccccccccccc',
            chainId: 1,
          },
        };

        // Mock: No duplicate
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Creation
        prismaMock.token.create.mockResolvedValue({
          id: 'token_zero',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
          config: input.config,
        });

        // Execute
        const result = await service.create(input);

        // Verify
        expect(result.decimals).toBe(0);
      });

      it('should handle high decimals', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'High Decimals',
          symbol: 'HIGH',
          decimals: 77,
          config: {
            address: '0xdddddddddddddddddddddddddddddddddddddddd',
            chainId: 1,
          },
        };

        // Mock: No duplicate
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Creation
        prismaMock.token.create.mockResolvedValue({
          id: 'token_high',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
          config: input.config,
        });

        // Execute
        const result = await service.create(input);

        // Verify
        expect(result.decimals).toBe(77);
      });

      it('should handle zero marketCap', async () => {
        const input = {
          tokenType: 'erc20' as const,
          name: 'Zero MarketCap',
          symbol: 'ZMC',
          decimals: 18,
          marketCap: 0,
          config: {
            address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            chainId: 1,
          },
        };

        // Mock: No duplicate
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Creation
        prismaMock.token.create.mockResolvedValue({
          id: 'token_zmc',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: input.name,
          symbol: input.symbol,
          decimals: input.decimals,
          logoUrl: null,
          coingeckoId: null,
          marketCap: input.marketCap,
          config: input.config,
        });

        // Execute
        const result = await service.create(input);

        // Verify
        expect(result.marketCap).toBe(0);
      });
    });
  });

  // ==========================================================================
  // Find By Address and Chain Tests
  // ==========================================================================

  describe('findByAddressAndChain', () => {
    describe('successful queries', () => {
      it('should find existing token', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findFirst.mockResolvedValue(dbResult);

        // Execute
        const result = await service.findByAddressAndChain(
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          1
        );

        // Verify
        expect(result).not.toBeNull();
        expect(result?.symbol).toBe('USDC');
        expect(result?.config.chainId).toBe(1);

        // Verify query was made
        expect(prismaMock.token.findFirst).toHaveBeenCalledTimes(1);
      });

      it('should return null when token not found', async () => {
        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Execute
        const result = await service.findByAddressAndChain(
          '0x9999999999999999999999999999999999999999',
          1
        );

        // Verify
        expect(result).toBeNull();
      });

      it('should normalize lowercase address', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findFirst.mockResolvedValue(dbResult);

        // Execute with lowercase address
        await service.findByAddressAndChain(
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          1
        );

        // Verify query used normalized address
        expect(prismaMock.token.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              config: expect.objectContaining({
                path: ['address'],
                equals: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              }),
            }),
          })
        );
      });

      it('should normalize mixed case address', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findFirst.mockResolvedValue(dbResult);

        // Execute with mixed case address (not proper checksum)
        await service.findByAddressAndChain(
          '0xa0B86991c6218b36c1d19d4A2e9Eb0cE3606eB48',
          1
        );

        // Verify query used normalized address
        expect(prismaMock.token.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              config: expect.objectContaining({
                path: ['address'],
                equals: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              }),
            }),
          })
        );
      });

      it('should distinguish between different chains', async () => {
        // Mock: Token exists on Ethereum
        prismaMock.token.findFirst.mockResolvedValue({
          id: 'token_usdc_eth',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
          config: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            chainId: 1,
          },
        });

        // Execute
        const result = await service.findByAddressAndChain(
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          1 // Ethereum
        );

        // Verify
        expect(result?.config.chainId).toBe(1);

        // Verify query included chainId filter
        expect(prismaMock.token.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              AND: expect.objectContaining({
                config: expect.objectContaining({
                  path: ['chainId'],
                  equals: 1,
                }),
              }),
            }),
          })
        );
      });
    });

    describe('validation errors', () => {
      it('should throw error for invalid address format', async () => {
        await expect(
          service.findByAddressAndChain('invalid-address', 1)
        ).rejects.toThrow('Invalid Ethereum address format');

        // Should fail before DB query
        expect(prismaMock.token.findFirst).not.toHaveBeenCalled();
      });

      it('should throw error for too short address', async () => {
        await expect(
          service.findByAddressAndChain('0x123', 1)
        ).rejects.toThrow('Invalid Ethereum address format');
      });

      it('should throw error for address without 0x prefix', async () => {
        await expect(
          service.findByAddressAndChain(
            'A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            1
          )
        ).rejects.toThrow('Invalid Ethereum address format');
      });
    });
  });

  // ==========================================================================
  // Find By ID Tests
  // ==========================================================================

  describe('findById', () => {
    it('should find existing ERC-20 token', async () => {
      const { dbResult } = USDC_ETHEREUM;

      // Mock: Token exists
      prismaMock.token.findUnique.mockResolvedValue(dbResult);

      // Execute
      const result = await service.findById('token_usdc_eth_001');

      // Verify
      expect(result).not.toBeNull();
      expect(result?.symbol).toBe('USDC');
      expect(result?.tokenType).toBe('erc20');
    });

    it('should return null when token not found', async () => {
      // Mock: Token doesn't exist
      prismaMock.token.findUnique.mockResolvedValue(null);

      // Execute
      const result = await service.findById('nonexistent_token');

      // Verify
      expect(result).toBeNull();
    });

    it('should return null when token is not ERC-20', async () => {
      // Mock: Token exists but is Solana SPL type
      prismaMock.token.findUnique.mockResolvedValue({
        id: 'token_sol_001',
        createdAt: new Date(),
        updatedAt: new Date(),
        tokenType: 'solana-spl', // Not ERC-20!
        name: 'Wrapped SOL',
        symbol: 'SOL',
        decimals: 9,
        logoUrl: null,
        coingeckoId: null,
        marketCap: null,
        config: {
          mint: 'So11111111111111111111111111111111111111112',
        },
      });

      // Execute
      const result = await service.findById('token_sol_001');

      // Verify: Returns null because it's not ERC-20
      expect(result).toBeNull();
    });

    it('should include all token fields', async () => {
      // Mock: Token with optional fields
      prismaMock.token.findUnique.mockResolvedValue({
        id: 'token_complete',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        tokenType: 'erc20',
        name: 'Complete Token',
        symbol: 'COMP',
        decimals: 18,
        logoUrl: 'https://example.com/logo.png',
        coingeckoId: 'complete-token',
        marketCap: 5000000,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Execute
      const result = await service.findById('token_complete');

      // Verify all fields
      expect(result?.id).toBe('token_complete');
      expect(result?.name).toBe('Complete Token');
      expect(result?.symbol).toBe('COMP');
      expect(result?.decimals).toBe(18);
      expect(result?.logoUrl).toBe('https://example.com/logo.png');
      expect(result?.coingeckoId).toBe('complete-token');
      expect(result?.marketCap).toBe(5000000);
      expect(result?.config.address).toBe(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      );
      expect(result?.config.chainId).toBe(1);
    });

    it('should handle tokens without optional fields', async () => {
      // Mock: Token without optional fields
      prismaMock.token.findUnique.mockResolvedValue({
        id: 'token_minimal',
        createdAt: new Date(),
        updatedAt: new Date(),
        tokenType: 'erc20',
        name: 'Minimal Token',
        symbol: 'MIN',
        decimals: 18,
        logoUrl: null,
        coingeckoId: null,
        marketCap: null,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Execute
      const result = await service.findById('token_minimal');

      // Verify optional fields are undefined
      expect(result?.logoUrl).toBeUndefined();
      expect(result?.coingeckoId).toBeUndefined();
      expect(result?.marketCap).toBeUndefined();
    });

    it('should map dates correctly', async () => {
      const createdDate = new Date('2024-01-01T10:00:00Z');
      const updatedDate = new Date('2024-01-02T15:30:00Z');

      // Mock: Token with specific dates
      prismaMock.token.findUnique.mockResolvedValue({
        id: 'token_dates',
        createdAt: createdDate,
        updatedAt: updatedDate,
        tokenType: 'erc20',
        name: 'Date Token',
        symbol: 'DATE',
        decimals: 18,
        logoUrl: null,
        coingeckoId: null,
        marketCap: null,
        config: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        },
      });

      // Execute
      const result = await service.findById('token_dates');

      // Verify dates
      expect(result?.createdAt).toEqual(createdDate);
      expect(result?.updatedAt).toEqual(updatedDate);
    });
  });

  // ==========================================================================
  // Update Tests
  // ==========================================================================

  describe('update', () => {
    describe('successful updates', () => {
      it('should update basic fields', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findUnique.mockResolvedValue(dbResult);

        // Mock: Update succeeds
        prismaMock.token.update.mockResolvedValue({
          ...dbResult,
          name: 'USD Coin Updated',
          symbol: 'USDC2',
        });

        // Execute
        const result = await service.update('token_usdc_eth_001', {
          name: 'USD Coin Updated',
          symbol: 'USDC2',
        });

        // Verify
        expect(result.name).toBe('USD Coin Updated');
        expect(result.symbol).toBe('USDC2');

        // Verify update was called
        expect(prismaMock.token.update).toHaveBeenCalledTimes(1);
      });

      it('should update optional fields', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findUnique.mockResolvedValue(dbResult);

        // Mock: Update succeeds
        prismaMock.token.update.mockResolvedValue({
          ...dbResult,
          logoUrl: 'https://example.com/new-logo.png',
          coingeckoId: 'usdc-updated',
          marketCap: 35000000000,
        });

        // Execute
        const result = await service.update('token_usdc_eth_001', {
          logoUrl: 'https://example.com/new-logo.png',
          coingeckoId: 'usdc-updated',
          marketCap: 35000000000,
        });

        // Verify
        expect(result.logoUrl).toBe('https://example.com/new-logo.png');
        expect(result.coingeckoId).toBe('usdc-updated');
        expect(result.marketCap).toBe(35000000000);
      });

      it('should update address with normalization', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findUnique.mockResolvedValue(dbResult);

        const newAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7'; // lowercase

        // Mock: Update succeeds
        prismaMock.token.update.mockResolvedValue({
          ...dbResult,
          config: {
            address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // normalized
            chainId: 1,
          },
        });

        // Execute
        const result = await service.update('token_usdc_eth_001', {
          config: {
            address: newAddress,
            chainId: 1,
          },
        });

        // Verify address was normalized
        expect(result.config.address).toBe(
          '0xdAC17F958D2ee523a2206206994597C13D831ec7'
        );
      });

      it('should update chainId in config', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findUnique.mockResolvedValue(dbResult);

        // Mock: Update succeeds
        prismaMock.token.update.mockResolvedValue({
          ...dbResult,
          config: {
            address: dbResult.config.address,
            chainId: 42161, // Arbitrum
          },
        });

        // Execute
        const result = await service.update('token_usdc_eth_001', {
          config: {
            address: dbResult.config.address,
            chainId: 42161,
          },
        });

        // Verify
        expect(result.config.chainId).toBe(42161);
      });

      it('should handle partial updates', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findUnique.mockResolvedValue(dbResult);

        // Mock: Update only name
        prismaMock.token.update.mockResolvedValue({
          ...dbResult,
          name: 'Updated Name Only',
        });

        // Execute (only update name)
        const result = await service.update('token_usdc_eth_001', {
          name: 'Updated Name Only',
        });

        // Verify only name changed
        expect(result.name).toBe('Updated Name Only');
        expect(result.symbol).toBe('USDC'); // Unchanged
        expect(result.decimals).toBe(6); // Unchanged
      });

      it('should update multiple fields at once', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findUnique.mockResolvedValue(dbResult);

        // Mock: Update multiple fields
        prismaMock.token.update.mockResolvedValue({
          ...dbResult,
          name: 'New Name',
          symbol: 'NEW',
          decimals: 18,
          logoUrl: 'https://example.com/logo.png',
          marketCap: 999999,
        });

        // Execute
        const result = await service.update('token_usdc_eth_001', {
          name: 'New Name',
          symbol: 'NEW',
          decimals: 18,
          logoUrl: 'https://example.com/logo.png',
          marketCap: 999999,
        });

        // Verify all updated
        expect(result.name).toBe('New Name');
        expect(result.symbol).toBe('NEW');
        expect(result.decimals).toBe(18);
        expect(result.logoUrl).toBe('https://example.com/logo.png');
        expect(result.marketCap).toBe(999999);
      });
    });

    describe('validation errors', () => {
      it('should throw error when token not found', async () => {
        // Mock: Token doesn't exist
        prismaMock.token.findUnique.mockResolvedValue(null);

        await expect(
          service.update('nonexistent_token', { name: 'New Name' })
        ).rejects.toThrow('Token with id nonexistent_token not found');

        // Verify update was not attempted
        expect(prismaMock.token.update).not.toHaveBeenCalled();
      });

      it('should throw error when token is not ERC-20', async () => {
        // Mock: Token exists but is Solana type
        prismaMock.token.findUnique.mockResolvedValue({
          id: 'token_sol_001',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'solana-spl', // Not ERC-20!
          name: 'Wrapped SOL',
          symbol: 'SOL',
          decimals: 9,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
          config: {
            mint: 'So11111111111111111111111111111111111111112',
          },
        });

        await expect(
          service.update('token_sol_001', { name: 'New Name' })
        ).rejects.toThrow('is not an ERC-20 token');

        // Verify update was not attempted
        expect(prismaMock.token.update).not.toHaveBeenCalled();
      });

      it('should throw error for invalid address in config update', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findUnique.mockResolvedValue(dbResult);

        await expect(
          service.update('token_usdc_eth_001', {
            config: {
              address: 'invalid-address',
              chainId: 1,
            },
          })
        ).rejects.toThrow('Invalid Ethereum address format');

        // Verify update was not attempted
        expect(prismaMock.token.update).not.toHaveBeenCalled();
      });

      it('should throw error for too short address in config update', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findUnique.mockResolvedValue(dbResult);

        await expect(
          service.update('token_usdc_eth_001', {
            config: {
              address: '0x123',
              chainId: 1,
            },
          })
        ).rejects.toThrow('Invalid Ethereum address format');
      });
    });
  });

  // ==========================================================================
  // Delete Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete existing ERC-20 token', async () => {
      const { dbResult } = USDC_ETHEREUM;

      // Mock: Token exists
      prismaMock.token.findUnique.mockResolvedValue(dbResult);

      // Mock: Delete succeeds
      prismaMock.token.delete.mockResolvedValue(dbResult);

      // Execute
      await service.delete('token_usdc_eth_001');

      // Verify delete was called
      expect(prismaMock.token.delete).toHaveBeenCalledWith({
        where: { id: 'token_usdc_eth_001' },
      });
    });

    it('should be idempotent - silently return when token not found', async () => {
      // Mock: Token doesn't exist
      prismaMock.token.findUnique.mockResolvedValue(null);

      // Should not throw error
      await expect(service.delete('nonexistent_token')).resolves.toBeUndefined();

      // Verify delete was not attempted
      expect(prismaMock.token.delete).not.toHaveBeenCalled();
    });

    it('should throw error when token is not ERC-20 (type safety)', async () => {
      // Mock: Token exists but is Solana type
      prismaMock.token.findUnique.mockResolvedValue({
        id: 'token_sol_001',
        createdAt: new Date(),
        updatedAt: new Date(),
        tokenType: 'solana-spl', // Not ERC-20!
        name: 'Wrapped SOL',
        symbol: 'SOL',
        decimals: 9,
        logoUrl: null,
        coingeckoId: null,
        marketCap: null,
        config: {
          mint: 'So11111111111111111111111111111111111111112',
        },
      });

      await expect(service.delete('token_sol_001')).rejects.toThrow(
        'is not an ERC-20 token'
      );

      // Verify delete was not attempted
      expect(prismaMock.token.delete).not.toHaveBeenCalled();
    });

    it('should be idempotent - allow multiple deletes without error', async () => {
      const { dbResult } = USDC_ETHEREUM;

      // First call: Token exists
      prismaMock.token.findUnique.mockResolvedValueOnce(dbResult);
      prismaMock.token.delete.mockResolvedValue(dbResult);

      await service.delete('token_usdc_eth_001');

      // Second call: Token doesn't exist (already deleted)
      prismaMock.token.findUnique.mockResolvedValueOnce(null);

      // Should still succeed without error
      await expect(service.delete('token_usdc_eth_001')).resolves.toBeUndefined();
    });

    it('should verify token type before deletion', async () => {
      const { dbResult } = USDC_ETHEREUM;

      // Mock: Token exists and is ERC-20
      prismaMock.token.findUnique.mockResolvedValue(dbResult);

      // Mock: Delete succeeds
      prismaMock.token.delete.mockResolvedValue(dbResult);

      // Execute
      await service.delete('token_usdc_eth_001');

      // Verify existence check was performed first
      expect(prismaMock.token.findUnique).toHaveBeenCalledWith({
        where: { id: 'token_usdc_eth_001' },
      });
    });

    it('should not return anything on successful deletion', async () => {
      const { dbResult } = USDC_ETHEREUM;

      // Mock: Token exists
      prismaMock.token.findUnique.mockResolvedValue(dbResult);

      // Mock: Delete succeeds
      prismaMock.token.delete.mockResolvedValue(dbResult);

      // Execute
      const result = await service.delete('token_usdc_eth_001');

      // Verify returns void (undefined)
      expect(result).toBeUndefined();
    });

    it('should handle deletion with all safeguards', async () => {
      const { dbResult } = USDC_ETHEREUM;

      // Mock: Token exists and is ERC-20
      prismaMock.token.findUnique.mockResolvedValue(dbResult);

      // Mock: Delete succeeds
      prismaMock.token.delete.mockResolvedValue(dbResult);

      // Execute
      await service.delete('token_usdc_eth_001');

      // Verify both checks were performed (findUnique called twice: once in findById, once in delete)
      expect(prismaMock.token.findUnique).toHaveBeenCalledTimes(2);
      expect(prismaMock.token.delete).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Token Discovery Tests
  // ==========================================================================

  describe('discover', () => {
    describe('successful discovery', () => {
      it('should discover new token from contract', async () => {
        const { input, dbResult } = DISCOVERED_TOKEN;

        // Mock: Token doesn't exist in DB (both checks: in discover and in create)
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Chain is supported
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getSupportedChainIds.mockReturnValue([1, 42161]);

        // Mock: Get public client
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Contract read returns metadata
        publicClientMock.multicall.mockResolvedValue([
          input.name,
          input.symbol,
          input.decimals,
        ]);

        // Mock: CoinGecko enrichment data
        coinGeckoClientMock.getErc20EnrichmentData.mockResolvedValue({
          coingeckoId: 'discovered-token',
          logoUrl: 'https://example.com/discovered.png',
          marketCap: 1000000,
          symbol: input.symbol,
          name: input.name,
        });

        // Mock: Token creation
        prismaMock.token.create.mockResolvedValue(dbResult);

        // Execute
        const result = await service.discover({
          address: input.config.address,
          chainId: input.config.chainId,
        });

        // Verify
        expect(result.name).toBe('Discovered Token');
        expect(result.symbol).toBe('DISC');
        expect(result.decimals).toBe(18);

        // Verify DB lookup was attempted (twice: once in discover, once in create's duplicate check)
        expect(prismaMock.token.findFirst).toHaveBeenCalledTimes(2);

        // Verify chain support check
        expect(evmConfigMock.isChainSupported).toHaveBeenCalledWith(1);

        // Verify public client was requested
        expect(evmConfigMock.getPublicClient).toHaveBeenCalledWith(1);

        // Verify multicall was made
        expect(publicClientMock.multicall).toHaveBeenCalledTimes(1);

        // Verify CoinGecko enrichment was fetched
        expect(coinGeckoClientMock.getErc20EnrichmentData).toHaveBeenCalledWith(1, input.config.address);

        // Verify token was created
        expect(prismaMock.token.create).toHaveBeenCalledTimes(1);
      });

      it('should return existing token without RPC call', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists in DB
        prismaMock.token.findFirst.mockResolvedValue(dbResult);

        // Execute
        const result = await service.discover({
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
        });

        // Verify
        expect(result.symbol).toBe('USDC');

        // Verify DB lookup was attempted
        expect(prismaMock.token.findFirst).toHaveBeenCalledTimes(1);

        // Verify no chain operations (token already existed)
        expect(evmConfigMock.isChainSupported).not.toHaveBeenCalled();
        expect(evmConfigMock.getPublicClient).not.toHaveBeenCalled();
        expect(publicClientMock.multicall).not.toHaveBeenCalled();
        expect(prismaMock.token.create).not.toHaveBeenCalled();
      });

      it('should normalize address before lookup', async () => {
        const { dbResult } = USDC_ETHEREUM;

        // Mock: Token exists
        prismaMock.token.findFirst.mockResolvedValue(dbResult);

        // Execute with lowercase address
        await service.discover({
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          chainId: 1,
        });

        // Verify findFirst was called with normalized (checksummed) address
        expect(prismaMock.token.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              config: expect.objectContaining({
                path: ['address'],
                equals: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              }),
            }),
          })
        );
      });

      it('should handle tokens with special characters', async () => {
        const tokenWithSpecialChars = {
          name: 'Token 中文 🚀',
          symbol: '$MEME',
          decimals: 18,
          address: '0x8888888888888888888888888888888888888888',
          chainId: 1,
        };

        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Chain supported
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getSupportedChainIds.mockReturnValue([1]);

        // Mock: Public client
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Contract returns special chars
        publicClientMock.multicall.mockResolvedValue([
          tokenWithSpecialChars.name,
          tokenWithSpecialChars.symbol,
          tokenWithSpecialChars.decimals,
        ]);

        // Mock: CoinGecko enrichment data
        coinGeckoClientMock.getErc20EnrichmentData.mockResolvedValue({
          coingeckoId: 'special-token',
          logoUrl: 'https://example.com/special.png',
          marketCap: 500000,
          symbol: tokenWithSpecialChars.symbol,
          name: tokenWithSpecialChars.name,
        });

        // Mock: Create token
        prismaMock.token.create.mockResolvedValue({
          id: 'token_special',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          ...tokenWithSpecialChars,
          logoUrl: 'https://example.com/special.png',
          coingeckoId: 'special-token',
          marketCap: 500000,
          config: {
            address: tokenWithSpecialChars.address,
            chainId: tokenWithSpecialChars.chainId,
          },
        });

        // Execute
        const result = await service.discover({
          address: tokenWithSpecialChars.address,
          chainId: tokenWithSpecialChars.chainId,
        });

        // Verify special characters preserved
        expect(result.name).toBe('Token 中文 🚀');
        expect(result.symbol).toBe('$MEME');
      });
    });

    describe('validation errors', () => {
      it('should throw error for invalid address format', async () => {
        await expect(
          service.discover({ address: 'invalid-address', chainId: 1 })
        ).rejects.toThrow('Invalid Ethereum address format');

        // Should fail before DB lookup
        expect(prismaMock.token.findFirst).not.toHaveBeenCalled();
      });

      it('should throw error for too short address', async () => {
        await expect(service.discover({ address: '0x123', chainId: 1 })).rejects.toThrow(
          'Invalid Ethereum address format'
        );
      });

      it('should throw error for address without 0x prefix', async () => {
        await expect(
          service.discover({
            address: 'A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            chainId: 1,
          })
        ).rejects.toThrow('Invalid Ethereum address format');
      });

      it('should throw error for unsupported chain ID', async () => {
        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Chain not supported
        evmConfigMock.isChainSupported.mockReturnValue(false);
        evmConfigMock.getSupportedChainIds.mockReturnValue([1, 42161]);

        await expect(
          service.discover({ address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 999999 })
        ).rejects.toThrow('Chain 999999 is not configured');

        await expect(
          service.discover({ address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 999999 })
        ).rejects.toThrow('Supported chains: 1, 42161');
      });
    });

    describe('contract errors', () => {
      it('should throw TokenMetadataError for non-compliant contract', async () => {
        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Chain supported
        evmConfigMock.isChainSupported.mockReturnValue(true);

        // Mock: Public client
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Contract doesn't implement name()
        publicClientMock.multicall.mockResolvedValue(['', 'TOKEN', 18]);

        await expect(
          service.discover({
            address: NON_COMPLIANT_TOKEN.address,
            chainId: NON_COMPLIANT_TOKEN.chainId,
          })
        ).rejects.toThrow(TokenMetadataError);

        await expect(
          service.discover({
            address: NON_COMPLIANT_TOKEN.address,
            chainId: NON_COMPLIANT_TOKEN.chainId,
          })
        ).rejects.toThrow('does not implement name()');
      });

      it('should throw error for contract execution revert', async () => {
        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Chain supported
        evmConfigMock.isChainSupported.mockReturnValue(true);

        // Mock: Public client
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Contract call reverts
        const revertError = new Error('execution reverted');
        publicClientMock.multicall.mockRejectedValue(revertError);

        await expect(
          service.discover({ address: '0x9999999999999999999999999999999999999999', chainId: 1 })
        ).rejects.toThrow(TokenMetadataError);

        await expect(
          service.discover({ address: '0x9999999999999999999999999999999999999999', chainId: 1 })
        ).rejects.toThrow('execution reverted');
      });

      it('should throw error for non-contract address', async () => {
        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Chain supported
        evmConfigMock.isChainSupported.mockReturnValue(true);

        // Mock: Public client
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: No code at address
        const codeNotFoundError = new Error('Code not found');
        publicClientMock.multicall.mockRejectedValue(codeNotFoundError);

        await expect(
          service.discover({ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', chainId: 1 })
        ).rejects.toThrow(TokenMetadataError);
      });

      it('should wrap network errors in TokenMetadataError', async () => {
        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Chain supported
        evmConfigMock.isChainSupported.mockReturnValue(true);

        // Mock: Public client
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Network error
        const networkError = new Error('Network request failed');
        publicClientMock.multicall.mockRejectedValue(networkError);

        await expect(
          service.discover({ address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', chainId: 1 })
        ).rejects.toThrow(TokenMetadataError);

        await expect(
          service.discover({ address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', chainId: 1 })
        ).rejects.toThrow('Network request failed');
      });
    });

    describe('edge cases', () => {
      it('should handle 0 decimals', async () => {
        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Chain supported
        evmConfigMock.isChainSupported.mockReturnValue(true);

        // Mock: Public client
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Contract returns 0 decimals
        publicClientMock.multicall.mockResolvedValue([
          'Zero Decimals',
          'ZERO',
          0,
        ]);

        // Mock: CoinGecko enrichment data
        coinGeckoClientMock.getErc20EnrichmentData.mockResolvedValue({
          coingeckoId: 'zero-token',
          logoUrl: 'https://example.com/zero.png',
          marketCap: 100000,
          symbol: 'ZERO',
          name: 'Zero Decimals',
        });

        // Mock: Create token
        prismaMock.token.create.mockResolvedValue({
          id: 'token_zero',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: 'Zero Decimals',
          symbol: 'ZERO',
          decimals: 0,
          logoUrl: 'https://example.com/zero.png',
          coingeckoId: 'zero-token',
          marketCap: 100000,
          config: {
            address: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
            chainId: 1,
          },
        });

        const result = await service.discover({ address: '0xcccccccccccccccccccccccccccccccccccccccc', chainId: 1 });

        expect(result.decimals).toBe(0);
      });

      it('should handle different chain IDs', async () => {
        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Arbitrum supported
        evmConfigMock.isChainSupported.mockReturnValue(true);

        // Mock: Public client for Arbitrum
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Contract read
        publicClientMock.multicall.mockResolvedValue(['USDC', 'USDC', 6]);

        // Mock: CoinGecko enrichment data
        coinGeckoClientMock.getErc20EnrichmentData.mockResolvedValue({
          coingeckoId: 'usd-coin',
          logoUrl: 'https://example.com/usdc.png',
          marketCap: 28000000000,
          symbol: 'USDC',
          name: 'USD Coin',
        });

        // Mock: Create token
        prismaMock.token.create.mockResolvedValue({
          id: 'token_usdc_arb',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'erc20',
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
          logoUrl: 'https://example.com/usdc.png',
          coingeckoId: 'usd-coin',
          marketCap: 28000000000,
          config: {
            address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            chainId: 42161,
          },
        });

        const result = await service.discover({ address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chainId: 42161 });

        expect(result.config.chainId).toBe(42161);
        expect(evmConfigMock.getPublicClient).toHaveBeenCalledWith(42161);
      });

      it('should only make one multicall per discovery', async () => {
        const { input, dbResult } = DISCOVERED_TOKEN;

        // Mock: Token doesn't exist
        prismaMock.token.findFirst.mockResolvedValue(null);

        // Mock: Chain supported
        evmConfigMock.isChainSupported.mockReturnValue(true);
        evmConfigMock.getSupportedChainIds.mockReturnValue([1]);

        // Mock: Public client
        evmConfigMock.getPublicClient.mockReturnValue(
          publicClientMock as unknown as PublicClient
        );

        // Mock: Contract read
        publicClientMock.multicall.mockResolvedValue([
          input.name,
          input.symbol,
          input.decimals,
        ]);

        // Mock: CoinGecko enrichment data
        coinGeckoClientMock.getErc20EnrichmentData.mockResolvedValue({
          coingeckoId: 'discovered-token',
          logoUrl: 'https://example.com/discovered.png',
          marketCap: 1000000,
          symbol: input.symbol,
          name: input.name,
        });

        // Mock: Create
        prismaMock.token.create.mockResolvedValue(dbResult);

        await service.discover({ address: input.config.address, chainId: input.config.chainId });

        // Should only call multicall once (efficient batch read)
        expect(publicClientMock.multicall).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ==========================================================================
  // EnrichToken Tests
  // ==========================================================================

  describe('enrichToken', () => {
    const mockEnrichmentData = {
      coingeckoId: 'usd-coin',
      logoUrl: 'https://example.com/usdc-logo.png',
      marketCap: 28000000000,
      symbol: 'USDC',
      name: 'USD Coin',
    };

    let coinGeckoClientMock: any;

    beforeEach(() => {
      // Mock CoinGecko client
      coinGeckoClientMock = {
        getErc20EnrichmentData: vi.fn(),
      };

      // Recreate service with mocked CoinGecko client
      service = new Erc20TokenService({
        prisma: prismaMock as unknown as PrismaClient,
        evmConfig: evmConfigMock as unknown as EvmConfig,
        coinGeckoClient: coinGeckoClientMock,
      });
    });

    describe('successful enrichment', () => {
      it('should enrich token with CoinGecko data', async () => {
        const tokenWithoutEnrichment = {
          ...USDC_ETHEREUM.dbResult,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
        };

        // Mock: Token exists in database
        prismaMock.token.findUnique.mockResolvedValue(tokenWithoutEnrichment);

        // Mock: CoinGecko enrichment data
        coinGeckoClientMock.getErc20EnrichmentData.mockResolvedValue(
          mockEnrichmentData
        );

        // Mock: Token update
        const enrichedToken = {
          ...tokenWithoutEnrichment,
          logoUrl: mockEnrichmentData.logoUrl,
          coingeckoId: mockEnrichmentData.coingeckoId,
          marketCap: mockEnrichmentData.marketCap,
        };
        prismaMock.token.update.mockResolvedValue(enrichedToken);

        const result = await service.enrichToken(tokenWithoutEnrichment.id);

        // Should load token from database
        expect(prismaMock.token.findUnique).toHaveBeenCalledWith({
          where: { id: tokenWithoutEnrichment.id },
        });

        // Should fetch enrichment data from CoinGecko
        expect(coinGeckoClientMock.getErc20EnrichmentData).toHaveBeenCalledWith(
          tokenWithoutEnrichment.config.chainId,
          tokenWithoutEnrichment.config.address
        );

        // Should update token with enrichment data
        expect(prismaMock.token.update).toHaveBeenCalledWith({
          where: { id: tokenWithoutEnrichment.id },
          data: {
            logoUrl: mockEnrichmentData.logoUrl,
            coingeckoId: mockEnrichmentData.coingeckoId,
            marketCap: mockEnrichmentData.marketCap,
          },
        });

        // Should return enriched token
        expect(result.logoUrl).toBe(mockEnrichmentData.logoUrl);
        expect(result.coingeckoId).toBe(mockEnrichmentData.coingeckoId);
        expect(result.marketCap).toBe(mockEnrichmentData.marketCap);
      });

      it('should handle tokens without existing enrichment data', async () => {
        const tokenWithoutEnrichment = {
          ...USDC_ETHEREUM.dbResult,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
        };

        prismaMock.token.findUnique.mockResolvedValue(
          tokenWithoutEnrichment
        );
        coinGeckoClientMock.getErc20EnrichmentData.mockResolvedValue(
          mockEnrichmentData
        );

        const enrichedToken = {
          ...tokenWithoutEnrichment,
          logoUrl: mockEnrichmentData.logoUrl,
          coingeckoId: mockEnrichmentData.coingeckoId,
          marketCap: mockEnrichmentData.marketCap,
        };
        prismaMock.token.update.mockResolvedValue(enrichedToken);

        const result = await service.enrichToken(tokenWithoutEnrichment.id);

        expect(result.logoUrl).toBe(mockEnrichmentData.logoUrl);
        expect(result.coingeckoId).toBe(mockEnrichmentData.coingeckoId);
        expect(result.marketCap).toBe(mockEnrichmentData.marketCap);
      });

      it('should skip enrichment if token already has coingeckoId', async () => {
        const alreadyEnrichedToken = {
          ...USDC_ETHEREUM.dbResult,
          logoUrl: 'https://existing-logo.com/usdc.png',
          coingeckoId: 'usd-coin',
          marketCap: 27000000000,
        };

        prismaMock.token.findUnique.mockResolvedValue(alreadyEnrichedToken);

        const result = await service.enrichToken(alreadyEnrichedToken.id);

        // Should return existing token without calling CoinGecko
        expect(coinGeckoClientMock.getErc20EnrichmentData).not.toHaveBeenCalled();
        expect(prismaMock.token.update).not.toHaveBeenCalled();

        // Should return token with existing enrichment data
        expect(result.coingeckoId).toBe('usd-coin');
        expect(result.logoUrl).toBe('https://existing-logo.com/usdc.png');
        expect(result.marketCap).toBe(27000000000);
      });
    });

    describe('error handling', () => {
      it('should throw error if token not found in database', async () => {
        prismaMock.token.findUnique.mockResolvedValue(null);

        await expect(
          service.enrichToken('non-existent-token-id')
        ).rejects.toThrow('Token with id non-existent-token-id not found');

        // Should not call CoinGecko or update
        expect(coinGeckoClientMock.getErc20EnrichmentData).not.toHaveBeenCalled();
        expect(prismaMock.token.update).not.toHaveBeenCalled();
      });

      it('should throw error if token is not ERC-20 type', async () => {
        const solanaToken = {
          id: 'token_solana_001',
          createdAt: new Date(),
          updatedAt: new Date(),
          tokenType: 'solana-spl',
          name: 'Wrapped SOL',
          symbol: 'SOL',
          decimals: 9,
          logoUrl: null,
          coingeckoId: null,
          marketCap: null,
          config: {
            mint: 'So11111111111111111111111111111111111111112',
          },
        };

        prismaMock.token.findUnique.mockResolvedValue(solanaToken);

        await expect(service.enrichToken(solanaToken.id)).rejects.toThrow(
          `Token ${solanaToken.id} is not an ERC-20 token (type: solana-spl)`
        );

        // Should not call CoinGecko or update
        expect(coinGeckoClientMock.getErc20EnrichmentData).not.toHaveBeenCalled();
        expect(prismaMock.token.update).not.toHaveBeenCalled();
      });

      it('should throw error if token not found in CoinGecko', async () => {
        const tokenWithoutEnrichment = {
          ...USDC_ETHEREUM.dbResult,
          coingeckoId: null,
        };

        prismaMock.token.findUnique.mockResolvedValue(tokenWithoutEnrichment);

        // Mock: Token not found in CoinGecko
        const error = new Error('Token not found in CoinGecko');
        error.name = 'TokenNotFoundInCoinGeckoError';
        coinGeckoClientMock.getErc20EnrichmentData.mockRejectedValue(error);

        await expect(service.enrichToken(tokenWithoutEnrichment.id)).rejects.toThrow(
          'Token not found in CoinGecko'
        );

        // Should not update token
        expect(prismaMock.token.update).not.toHaveBeenCalled();
      });

      it('should throw error if CoinGecko API fails', async () => {
        const tokenWithoutEnrichment = {
          ...USDC_ETHEREUM.dbResult,
          coingeckoId: null,
        };

        prismaMock.token.findUnique.mockResolvedValue(tokenWithoutEnrichment);

        // Mock: CoinGecko API error
        const error = new Error('CoinGecko API error: 429 Too Many Requests');
        error.name = 'CoinGeckoApiError';
        coinGeckoClientMock.getErc20EnrichmentData.mockRejectedValue(error);

        await expect(service.enrichToken(tokenWithoutEnrichment.id)).rejects.toThrow(
          'CoinGecko API error: 429 Too Many Requests'
        );

        // Should not update token
        expect(prismaMock.token.update).not.toHaveBeenCalled();
      });
    });

    describe('integration with address normalization', () => {
      it('should work with any case address in token config', async () => {
        const tokenWithLowercaseAddress = {
          ...USDC_ETHEREUM.dbResult,
          coingeckoId: null,
          config: {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // lowercase
            chainId: 1,
          },
        };

        prismaMock.token.findUnique.mockResolvedValue(
          tokenWithLowercaseAddress
        );
        coinGeckoClientMock.getErc20EnrichmentData.mockResolvedValue(
          mockEnrichmentData
        );

        const enrichedToken = {
          ...tokenWithLowercaseAddress,
          logoUrl: mockEnrichmentData.logoUrl,
          coingeckoId: mockEnrichmentData.coingeckoId,
          marketCap: mockEnrichmentData.marketCap,
        };
        prismaMock.token.update.mockResolvedValue(enrichedToken);

        await service.enrichToken(tokenWithLowercaseAddress.id);

        // Should pass lowercase address to CoinGecko (it handles normalization)
        expect(coinGeckoClientMock.getErc20EnrichmentData).toHaveBeenCalledWith(
          1,
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
        );
      });
    });
  });

  // ==========================================================================
  // Search Tests (Two-Tier: DB + CoinGecko)
  // ==========================================================================

  describe('searchTokens', () => {
    const chainId = 1; // Ethereum

    // Mock database tokens
    const mockDbToken1 = {
      id: '1',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      tokenType: 'erc20',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      logoUrl: 'https://...',
      coingeckoId: 'usd-coin',
      marketCap: 32000000000,
      config: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        chainId: 1,
      },
    };

    const mockDbToken2 = {
      id: '2',
      createdAt: new Date('2024-01-02'),
      updatedAt: new Date('2024-01-02'),
      tokenType: 'erc20',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
      logoUrl: 'https://...',
      coingeckoId: 'tether',
      marketCap: 95000000000,
      config: {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        chainId: 1,
      },
    };

    const mockDbToken3 = {
      id: '3',
      createdAt: new Date('2024-01-03'),
      updatedAt: new Date('2024-01-03'),
      tokenType: 'erc20',
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
      logoUrl: 'https://...',
      coingeckoId: 'weth',
      marketCap: 12000000000,
      config: {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        chainId: 1,
      },
    };

    // Mock CoinGecko tokens (different addresses)
    const mockCgToken1 = {
      coingeckoId: 'dai',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    };

    const mockCgToken2 = {
      coingeckoId: 'frax',
      symbol: 'FRAX',
      name: 'Frax',
      address: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
    };

    // Setup mocks before each search test
    beforeEach(() => {
      evmConfigMock.isChainSupported.mockReturnValue(true);
      evmConfigMock.getSupportedChainIds.mockReturnValue([1, 42161, 8453]);
    });

    describe('database-first priority', () => {
      it('should return DB results ordered by market cap DESC when 10+ results', async () => {
        // Return 10 DB results (no CoinGecko needed)
        const tenTokens = Array.from({ length: 10 }, (_, i) => ({
          ...mockDbToken1,
          id: `db-${i}`,
          symbol: `TOKEN${i}`,
          marketCap: 1000000 * (10 - i), // Descending market cap
          config: { address: `0x${i.toString().padStart(40, '0')}`, chainId: 1 },
        }));

        prismaMock.token.findMany.mockResolvedValue(tenTokens);

        const result = await service.searchTokens({ chainId, symbol: 'token' });

        expect(result).toHaveLength(10);
        // Verify all results are from DB
        expect(result.every((r) => r.coingeckoId === 'usd-coin')).toBe(true);
        // Verify CoinGecko was NOT called
        expect(coinGeckoClientMock.searchTokens).not.toHaveBeenCalled();
        // Verify ordering by market cap
        expect(prismaMock.token.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: [
              { marketCap: { sort: 'desc', nulls: 'last' } },
              { symbol: 'asc' },
            ],
          })
        );
      });

      it('should combine DB (< 10) + CoinGecko results, DB first', async () => {
        // 2 DB results
        prismaMock.token.findMany.mockResolvedValue([mockDbToken1, mockDbToken2]);

        // 2 CoinGecko results
        coinGeckoClientMock.searchTokens.mockResolvedValue([
          mockCgToken1,
          mockCgToken2,
        ]);

        const result = await service.searchTokens({ chainId, symbol: 'usd' });

        expect(result).toHaveLength(4);
        // First 2 are from DB (ordered by market cap: USDT > USDC)
        expect(result[0].symbol).toBe('USDC');
        expect(result[1].symbol).toBe('USDT');
        // Next 2 are from CoinGecko
        expect(result[2].symbol).toBe('DAI');
        expect(result[3].symbol).toBe('FRAX');

        // Verify CoinGecko was called with correct params
        expect(coinGeckoClientMock.searchTokens).toHaveBeenCalledWith({
          platform: 'ethereum',
          symbol: 'usd',
          name: undefined,
          address: undefined,
        });
      });
    });

    describe('deduplication', () => {
      it('should filter out CoinGecko tokens already in DB (case-insensitive)', async () => {
        // 2 DB results
        prismaMock.token.findMany.mockResolvedValue([mockDbToken1, mockDbToken2]);

        // CoinGecko returns USDC (duplicate) + DAI (unique)
        coinGeckoClientMock.searchTokens.mockResolvedValue([
          { ...mockCgToken1 },
          {
            coingeckoId: 'usd-coin-duplicate',
            symbol: 'USDC',
            name: 'USD Coin',
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Same as DB (different case)
          },
        ]);

        const result = await service.searchTokens({ chainId, symbol: 'usd' });

        expect(result).toHaveLength(3); // 2 DB + 1 CG (duplicate removed)
        expect(result[0].symbol).toBe('USDC'); // From DB
        expect(result[1].symbol).toBe('USDT'); // From DB
        expect(result[2].symbol).toBe('DAI'); // From CG (unique)
      });
    });

    describe('address search', () => {
      it('should search by address only (exact match, case-insensitive)', async () => {
        const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // Lowercase

        prismaMock.token.findMany.mockResolvedValue([mockDbToken1]);

        // Mock CoinGecko (won't be called since DB returned 1 result, but need to handle if < 10)
        coinGeckoClientMock.searchTokens.mockResolvedValue([]);

        const result = await service.searchTokens({ chainId, address: usdcAddress });

        expect(result).toHaveLength(1);
        expect(result[0].symbol).toBe('USDC');

        // Verify address was normalized and used in query
        expect(prismaMock.token.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              AND: {
                config: {
                  path: ['address'],
                  equals: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Checksummed
                },
              },
            }),
          })
        );
      });

      it('should throw error for invalid address format', async () => {
        await expect(
          service.searchTokens({ chainId, address: 'invalid-address' })
        ).rejects.toThrow('Invalid Ethereum address format');

        expect(prismaMock.token.findMany).not.toHaveBeenCalled();
      });
    });

    describe('validation', () => {
      it('should throw error if no search parameters provided', async () => {
        await expect(
          service.searchTokens({ chainId })
        ).rejects.toThrow(
          'At least one search parameter (symbol, name, or address) must be provided'
        );

        expect(prismaMock.token.findMany).not.toHaveBeenCalled();
      });
    });

    describe('max 10 results', () => {
      it('should limit CoinGecko results to (10 - dbCount)', async () => {
        // 3 DB results
        prismaMock.token.findMany.mockResolvedValue([
          mockDbToken1,
          mockDbToken2,
          mockDbToken3,
        ]);

        // 20 CoinGecko results
        const twentyCgTokens = Array.from({ length: 20 }, (_, i) => ({
          coingeckoId: `token-${i}`,
          symbol: `TKN${i}`,
          name: `Token ${i}`,
          address: `0x${(i + 100).toString().padStart(40, '0')}`,
        }));

        coinGeckoClientMock.searchTokens.mockResolvedValue(twentyCgTokens);

        const result = await service.searchTokens({ chainId, symbol: 'tk' });

        expect(result).toHaveLength(10); // 3 DB + 7 CG (not 3 + 20)
        // First 3 from DB
        expect(result[0].symbol).toBe('USDC');
        expect(result[1].symbol).toBe('USDT');
        expect(result[2].symbol).toBe('WETH');
        // Next 7 from CoinGecko
        expect(result[3].symbol).toBe('TKN0');
        expect(result[9].symbol).toBe('TKN6');
      });
    });
  });
});
