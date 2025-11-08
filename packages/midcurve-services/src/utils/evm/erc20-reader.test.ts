/**
 * Tests for ERC-20 Contract Reader
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PublicClient } from 'viem';
import { readTokenMetadata, TokenMetadataError } from './erc20-reader.js';

describe('readTokenMetadata', () => {
  const mockAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  let mockClient: ReturnType<typeof mockDeep<PublicClient>>;

  beforeEach(() => {
    mockClient = mockDeep<PublicClient>();
  });

  describe('successful reads', () => {
    it('should read token metadata successfully', async () => {
      // Mock multicall response
      mockClient.multicall.mockResolvedValue(['USD Coin', 'USDC', 6]);

      const result = await readTokenMetadata(mockClient, mockAddress);

      expect(result).toEqual({
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
      });

      // Verify multicall was called with correct params
      expect(mockClient.multicall).toHaveBeenCalledWith({
        contracts: [
          {
            address: mockAddress,
            abi: expect.any(Array),
            functionName: 'name',
          },
          {
            address: mockAddress,
            abi: expect.any(Array),
            functionName: 'symbol',
          },
          {
            address: mockAddress,
            abi: expect.any(Array),
            functionName: 'decimals',
          },
        ],
        allowFailure: false,
      });
    });

    it('should handle 18 decimals (WETH)', async () => {
      mockClient.multicall.mockResolvedValue([
        'Wrapped Ether',
        'WETH',
        18,
      ]);

      const result = await readTokenMetadata(mockClient, mockAddress);

      expect(result).toEqual({
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
      });
    });

    it('should handle 0 decimals', async () => {
      mockClient.multicall.mockResolvedValue(['Zero Decimals', 'ZERO', 0]);

      const result = await readTokenMetadata(mockClient, mockAddress);

      expect(result.decimals).toBe(0);
    });

    it('should handle special characters in name and symbol', async () => {
      mockClient.multicall.mockResolvedValue([
        'Ether.fi Staked ETH',
        '$MEME',
        18,
      ]);

      const result = await readTokenMetadata(mockClient, mockAddress);

      expect(result.name).toBe('Ether.fi Staked ETH');
      expect(result.symbol).toBe('$MEME');
    });

    it('should handle long token names', async () => {
      mockClient.multicall.mockResolvedValue([
        'Very Long Token Name That Exceeds Normal Expectations For Token Naming',
        'LONG',
        6,
      ]);

      const result = await readTokenMetadata(mockClient, mockAddress);

      expect(result.name).toBe(
        'Very Long Token Name That Exceeds Normal Expectations For Token Naming'
      );
    });
  });

  describe('validation errors', () => {
    it('should throw if name is empty string', async () => {
      mockClient.multicall.mockResolvedValue(['', 'USDC', 6]);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('does not implement name()');
    });

    it('should throw if name is not a string', async () => {
      mockClient.multicall.mockResolvedValue([123, 'USDC', 6]);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('does not implement name()');
    });

    it('should throw if symbol is empty string', async () => {
      mockClient.multicall.mockResolvedValue(['USD Coin', '', 6]);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('does not implement symbol()');
    });

    it('should throw if symbol is not a string', async () => {
      mockClient.multicall.mockResolvedValue(['USD Coin', 456, 6]);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('does not implement symbol()');
    });

    it('should throw if decimals is negative', async () => {
      mockClient.multicall.mockResolvedValue(['USD Coin', 'USDC', -1]);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('does not implement decimals()');
    });

    it('should throw if decimals is greater than 255', async () => {
      mockClient.multicall.mockResolvedValue(['USD Coin', 'USDC', 256]);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('does not implement decimals()');
    });

    it('should throw if decimals is not a number', async () => {
      mockClient.multicall.mockResolvedValue(['USD Coin', 'USDC', '6']);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('does not implement decimals()');
    });
  });

  describe('contract errors', () => {
    it('should wrap viem contract errors', async () => {
      const viemError = new Error('Contract execution reverted');
      mockClient.multicall.mockRejectedValue(viemError);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('Failed to read token metadata from contract');
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('Contract execution reverted');
    });

    it('should handle non-contract addresses', async () => {
      const error = new Error('Code not found');
      mockClient.multicall.mockRejectedValue(error);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
    });

    it('should handle network errors', async () => {
      const error = new Error('Network request failed');
      mockClient.multicall.mockRejectedValue(error);

      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow(TokenMetadataError);
      await expect(
        readTokenMetadata(mockClient, mockAddress)
      ).rejects.toThrow('Network request failed');
    });

    it('should preserve TokenMetadataError when rethrown', async () => {
      mockClient.multicall.mockResolvedValue(['', 'USDC', 6]);

      let caughtError: Error | null = null;
      try {
        await readTokenMetadata(mockClient, mockAddress);
      } catch (error) {
        caughtError = error as Error;
      }

      expect(caughtError).toBeInstanceOf(TokenMetadataError);
      expect(caughtError?.name).toBe('TokenMetadataError');
      expect((caughtError as TokenMetadataError).address).toBe(mockAddress);
    });

    it('should include address in TokenMetadataError', async () => {
      const error = new Error('Some error');
      mockClient.multicall.mockRejectedValue(error);

      try {
        await readTokenMetadata(mockClient, mockAddress);
      } catch (error) {
        expect((error as TokenMetadataError).address).toBe(mockAddress);
      }
    });

    it('should include cause in TokenMetadataError', async () => {
      const originalError = new Error('Original error');
      mockClient.multicall.mockRejectedValue(originalError);

      try {
        await readTokenMetadata(mockClient, mockAddress);
      } catch (error) {
        expect((error as TokenMetadataError).cause).toBe(originalError);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle single-character symbol', async () => {
      mockClient.multicall.mockResolvedValue(['Token', 'T', 6]);

      const result = await readTokenMetadata(mockClient, mockAddress);

      expect(result.symbol).toBe('T');
    });

    it('should handle unicode characters in name', async () => {
      mockClient.multicall.mockResolvedValue([
        'Token 中文 🚀',
        'UNI',
        18,
      ]);

      const result = await readTokenMetadata(mockClient, mockAddress);

      expect(result.name).toBe('Token 中文 🚀');
    });

    it('should handle maximum valid decimals (255)', async () => {
      mockClient.multicall.mockResolvedValue(['Max Decimals', 'MAX', 255]);

      const result = await readTokenMetadata(mockClient, mockAddress);

      expect(result.decimals).toBe(255);
    });

    it('should call multicall only once', async () => {
      mockClient.multicall.mockResolvedValue(['USD Coin', 'USDC', 6]);

      await readTokenMetadata(mockClient, mockAddress);

      expect(mockClient.multicall).toHaveBeenCalledTimes(1);
    });
  });
});
