/**
 * Tests for EVM Block Reader Utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PublicClient } from 'viem';
import { EvmConfig } from '../../config/evm.js';
import {
  getBlockByNumber,
  getBlockByTag,
  getCurrentBlockNumber,
} from './block-reader.js';

describe('Block Reader Utilities', () => {
  let mockEvmConfig: ReturnType<typeof mockDeep<EvmConfig>>;
  let mockClient: ReturnType<typeof mockDeep<PublicClient>>;
  const testChainId = 1; // Ethereum

  beforeEach(() => {
    mockEvmConfig = mockDeep<EvmConfig>();
    mockClient = mockDeep<PublicClient>();

    // Setup default mocks
    mockEvmConfig.getPublicClient.mockReturnValue(mockClient);
    mockEvmConfig.getChainConfig.mockReturnValue({
      chainId: testChainId,
      name: 'Ethereum',
      rpcUrl: 'https://eth-mainnet.example.com',
      blockExplorer: 'https://etherscan.io',
      viemChain: {} as any,
      finality: { type: 'blockTag' },
    });
  });

  describe('getBlockByNumber', () => {
    it('should retrieve block information by block number', async () => {
      const blockNumber = 19000000n;
      const mockBlock = {
        hash: '0xabc123',
        number: blockNumber,
        timestamp: 1700000000n,
        gasUsed: 15000000n,
        gasLimit: 30000000n,
        baseFeePerGas: 30000000000n,
        transactions: ['0xtx1', '0xtx2', '0xtx3'],
        parentHash: '0xparent123',
      };

      mockClient.getBlock.mockResolvedValue(mockBlock as any);

      const result = await getBlockByNumber(blockNumber, testChainId, mockEvmConfig);

      expect(result).toEqual({
        hash: '0xabc123',
        number: blockNumber,
        timestamp: 1700000000n,
        gasUsed: 15000000n,
        gasLimit: 30000000n,
        baseFeePerGas: 30000000000n,
        transactionCount: 3,
        parentHash: '0xparent123',
      });

      expect(mockClient.getBlock).toHaveBeenCalledWith({
        blockNumber,
        includeTransactions: false,
      });
    });

    it('should handle blocks with null baseFeePerGas (pre-London)', async () => {
      const blockNumber = 12000000n;
      const mockBlock = {
        hash: '0xabc456',
        number: blockNumber,
        timestamp: 1600000000n,
        gasUsed: 12000000n,
        gasLimit: 12500000n,
        baseFeePerGas: null,
        transactions: ['0xtx1'],
        parentHash: '0xparent456',
      };

      mockClient.getBlock.mockResolvedValue(mockBlock as any);

      const result = await getBlockByNumber(blockNumber, testChainId, mockEvmConfig);

      expect(result.baseFeePerGas).toBeNull();
    });

    it('should handle blocks with undefined baseFeePerGas', async () => {
      const blockNumber = 12000000n;
      const mockBlock = {
        hash: '0xabc789',
        number: blockNumber,
        timestamp: 1600000000n,
        gasUsed: 12000000n,
        gasLimit: 12500000n,
        baseFeePerGas: undefined,
        transactions: [],
        parentHash: '0xparent789',
      };

      mockClient.getBlock.mockResolvedValue(mockBlock as any);

      const result = await getBlockByNumber(blockNumber, testChainId, mockEvmConfig);

      expect(result.baseFeePerGas).toBeNull();
      expect(result.transactionCount).toBe(0);
    });

    it('should throw error if block is not found', async () => {
      const blockNumber = 99999999n;
      mockClient.getBlock.mockResolvedValue(null as any);

      await expect(
        getBlockByNumber(blockNumber, testChainId, mockEvmConfig)
      ).rejects.toThrow('Block not found: 99999999 on Ethereum');
    });

    it('should throw error if RPC call fails', async () => {
      const blockNumber = 19000000n;
      mockClient.getBlock.mockRejectedValue(new Error('RPC timeout'));

      await expect(
        getBlockByNumber(blockNumber, testChainId, mockEvmConfig)
      ).rejects.toThrow('Failed to get block 19000000 on Ethereum');
    });

    it('should call evmConfig methods with correct chain ID', async () => {
      const blockNumber = 19000000n;
      mockClient.getBlock.mockResolvedValue({
        hash: '0xtest',
        number: blockNumber,
        timestamp: 1700000000n,
        gasUsed: 15000000n,
        gasLimit: 30000000n,
        baseFeePerGas: 30000000000n,
        transactions: [],
        parentHash: '0xparent',
      } as any);

      await getBlockByNumber(blockNumber, testChainId, mockEvmConfig);

      expect(mockEvmConfig.getPublicClient).toHaveBeenCalledWith(testChainId);
      expect(mockEvmConfig.getChainConfig).toHaveBeenCalledWith(testChainId);
    });
  });

  describe('getBlockByTag', () => {
    it('should retrieve block by "finalized" tag', async () => {
      const mockBlock = {
        hash: '0xfinalized123',
        number: 18999990n,
        timestamp: 1699999999n,
        gasUsed: 14000000n,
        gasLimit: 30000000n,
        baseFeePerGas: 28000000000n,
        transactions: ['0xtx1', '0xtx2'],
        parentHash: '0xparentfin',
      };

      mockClient.getBlock.mockResolvedValue(mockBlock as any);

      const result = await getBlockByTag('finalized', testChainId, mockEvmConfig);

      expect(result).toEqual({
        hash: '0xfinalized123',
        number: 18999990n,
        timestamp: 1699999999n,
        gasUsed: 14000000n,
        gasLimit: 30000000n,
        baseFeePerGas: 28000000000n,
        transactionCount: 2,
        parentHash: '0xparentfin',
        blockTag: 'finalized',
      });

      expect(mockClient.getBlock).toHaveBeenCalledWith({
        blockTag: 'finalized',
        includeTransactions: false,
      });
    });

    it('should retrieve block by "safe" tag', async () => {
      const mockBlock = {
        hash: '0xsafe123',
        number: 18999995n,
        timestamp: 1700000001n,
        gasUsed: 15500000n,
        gasLimit: 30000000n,
        baseFeePerGas: 31000000000n,
        transactions: [],
        parentHash: '0xparentsafe',
      };

      mockClient.getBlock.mockResolvedValue(mockBlock as any);

      const result = await getBlockByTag('safe', testChainId, mockEvmConfig);

      expect(result?.blockTag).toBe('safe');
      expect(result?.number).toBe(18999995n);
    });

    it('should retrieve block by "latest" tag', async () => {
      const mockBlock = {
        hash: '0xlatest123',
        number: 19000001n,
        timestamp: 1700000012n,
        gasUsed: 16000000n,
        gasLimit: 30000000n,
        baseFeePerGas: 32000000000n,
        transactions: ['0xtx1'],
        parentHash: '0xparentlatest',
      };

      mockClient.getBlock.mockResolvedValue(mockBlock as any);

      const result = await getBlockByTag('latest', testChainId, mockEvmConfig);

      expect(result?.blockTag).toBe('latest');
      expect(result?.number).toBe(19000001n);
    });

    it('should return null if block tag is not supported by chain', async () => {
      mockClient.getBlock.mockRejectedValue(new Error('Block tag not supported'));

      const result = await getBlockByTag('finalized', testChainId, mockEvmConfig);

      expect(result).toBeNull();
    });

    it('should return null if block has no number', async () => {
      const mockBlock = {
        hash: '0xtest',
        number: null,
        timestamp: 1700000000n,
        gasUsed: 15000000n,
        gasLimit: 30000000n,
        baseFeePerGas: 30000000000n,
        transactions: [],
        parentHash: '0xparent',
      };

      mockClient.getBlock.mockResolvedValue(mockBlock as any);

      const result = await getBlockByTag('finalized', testChainId, mockEvmConfig);

      expect(result).toBeNull();
    });

    it('should handle null baseFeePerGas', async () => {
      const mockBlock = {
        hash: '0xtest',
        number: 12000000n,
        timestamp: 1600000000n,
        gasUsed: 12000000n,
        gasLimit: 12500000n,
        baseFeePerGas: null,
        transactions: [],
        parentHash: '0xparent',
      };

      mockClient.getBlock.mockResolvedValue(mockBlock as any);

      const result = await getBlockByTag('latest', testChainId, mockEvmConfig);

      expect(result?.baseFeePerGas).toBeNull();
    });
  });

  describe('getCurrentBlockNumber', () => {
    it('should retrieve the current block number', async () => {
      const currentBlockNumber = 19000100n;
      mockClient.getBlockNumber.mockResolvedValue(currentBlockNumber);

      const result = await getCurrentBlockNumber(testChainId, mockEvmConfig);

      expect(result).toBe(currentBlockNumber);
      expect(mockClient.getBlockNumber).toHaveBeenCalled();
    });

    it('should throw error if RPC call fails', async () => {
      mockClient.getBlockNumber.mockRejectedValue(new Error('Connection refused'));

      await expect(
        getCurrentBlockNumber(testChainId, mockEvmConfig)
      ).rejects.toThrow('Failed to get current block number on Ethereum');
    });

    it('should handle very large block numbers', async () => {
      const largeBlockNumber = 999999999999n;
      mockClient.getBlockNumber.mockResolvedValue(largeBlockNumber);

      const result = await getCurrentBlockNumber(testChainId, mockEvmConfig);

      expect(result).toBe(largeBlockNumber);
    });

    it('should call evmConfig methods with correct chain ID', async () => {
      mockClient.getBlockNumber.mockResolvedValue(19000100n);

      await getCurrentBlockNumber(testChainId, mockEvmConfig);

      expect(mockEvmConfig.getPublicClient).toHaveBeenCalledWith(testChainId);
      expect(mockEvmConfig.getChainConfig).toHaveBeenCalledWith(testChainId);
    });
  });
});
