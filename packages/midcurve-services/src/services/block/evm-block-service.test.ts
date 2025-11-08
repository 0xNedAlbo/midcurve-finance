/**
 * Tests for EVM Block Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { EvmBlockService } from './evm-block-service.js';
import type { EvmConfig } from '../../config/evm.js';
import type { PublicClient } from 'viem';
import type { EvmBlockInfo } from '../types/block/evm-block-info.js';

describe('EvmBlockService', () => {
  let service: EvmBlockService;
  let mockEvmConfig: ReturnType<typeof mockDeep<EvmConfig>>;
  let mockClient: ReturnType<typeof mockDeep<PublicClient>>;
  const testChainId = 1; // Ethereum

  // Test fixture for a typical block
  const createMockBlock = (overrides?: Partial<EvmBlockInfo>): any => ({
    hash: '0xabc123',
    number: 19000000n,
    timestamp: 1700000000n,
    gasUsed: 15000000n,
    gasLimit: 30000000n,
    baseFeePerGas: 30000000000n,
    transactions: ['0xtx1', '0xtx2'],
    parentHash: '0xparent123',
    ...overrides,
  });

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

    service = new EvmBlockService({ evmConfig: mockEvmConfig });
  });

  describe('constructor', () => {
    it('should create instance with provided dependencies', () => {
      const customService = new EvmBlockService({ evmConfig: mockEvmConfig });
      expect(customService).toBeInstanceOf(EvmBlockService);
    });

    it('should create instance with default dependencies', () => {
      // This would use the singleton EvmConfig
      const defaultService = new EvmBlockService();
      expect(defaultService).toBeInstanceOf(EvmBlockService);
    });
  });

  describe('getBlockByNumber', () => {
    it('should retrieve block by number', async () => {
      const blockNumber = 19000000n;
      const mockBlock = createMockBlock({ number: blockNumber });
      mockClient.getBlock.mockResolvedValue(mockBlock);

      const result = await service.getBlockByNumber(blockNumber, testChainId);

      expect(result.number).toBe(blockNumber);
      expect(result.hash).toBe('0xabc123');
      expect(mockEvmConfig.getPublicClient).toHaveBeenCalledWith(testChainId);
    });

    it('should handle errors from block reader', async () => {
      const blockNumber = 19000000n;
      mockClient.getBlock.mockRejectedValue(new Error('RPC timeout'));

      await expect(
        service.getBlockByNumber(blockNumber, testChainId)
      ).rejects.toThrow();
    });
  });

  describe('getBlockByTag', () => {
    it('should retrieve block by "finalized" tag', async () => {
      const mockBlock = createMockBlock();
      mockClient.getBlock.mockResolvedValue(mockBlock);

      const result = await service.getBlockByTag('finalized', testChainId);

      expect(result).not.toBeNull();
      expect(result?.blockTag).toBe('finalized');
      expect(mockClient.getBlock).toHaveBeenCalledWith({
        blockTag: 'finalized',
        includeTransactions: false,
      });
    });

    it('should retrieve block by "safe" tag', async () => {
      const mockBlock = createMockBlock();
      mockClient.getBlock.mockResolvedValue(mockBlock);

      const result = await service.getBlockByTag('safe', testChainId);

      expect(result).not.toBeNull();
      expect(result?.blockTag).toBe('safe');
    });

    it('should retrieve block by "latest" tag', async () => {
      const mockBlock = createMockBlock();
      mockClient.getBlock.mockResolvedValue(mockBlock);

      const result = await service.getBlockByTag('latest', testChainId);

      expect(result).not.toBeNull();
      expect(result?.blockTag).toBe('latest');
    });

    it('should return null if tag is not supported', async () => {
      mockClient.getBlock.mockRejectedValue(new Error('Tag not supported'));

      const result = await service.getBlockByTag('finalized', testChainId);

      expect(result).toBeNull();
    });
  });

  describe('getCurrentBlockNumber', () => {
    it('should retrieve current block number', async () => {
      const currentBlockNumber = 19000100n;
      mockClient.getBlockNumber.mockResolvedValue(currentBlockNumber);

      const result = await service.getCurrentBlockNumber(testChainId);

      expect(result).toBe(currentBlockNumber);
      expect(mockClient.getBlockNumber).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      mockClient.getBlockNumber.mockRejectedValue(
        new Error('Connection refused')
      );

      await expect(
        service.getCurrentBlockNumber(testChainId)
      ).rejects.toThrow();
    });
  });

  describe('getLastFinalizedBlockNumber', () => {
    describe('with blockTag finality config', () => {
      beforeEach(() => {
        mockEvmConfig.getFinalityConfig.mockReturnValue({
          type: 'blockTag',
        });
      });

      it('should retrieve finalized block number using blockTag', async () => {
        const finalizedBlockNumber = 18999990n;
        const mockBlock = createMockBlock({ number: finalizedBlockNumber });
        mockClient.getBlock.mockResolvedValue(mockBlock);

        const result = await service.getLastFinalizedBlockNumber(testChainId);

        expect(result).toBe(finalizedBlockNumber);
        expect(mockClient.getBlock).toHaveBeenCalledWith({
          blockTag: 'finalized',
          includeTransactions: false,
        });
      });

      it('should return null if finalized tag returns null', async () => {
        mockClient.getBlock.mockRejectedValue(
          new Error('Finalized tag not supported')
        );

        const result = await service.getLastFinalizedBlockNumber(testChainId);

        expect(result).toBeNull();
      });
    });

    describe('with blockHeight finality config', () => {
      beforeEach(() => {
        mockEvmConfig.getFinalityConfig.mockReturnValue({
          type: 'blockHeight',
          minBlockHeight: 64,
        });
      });

      it('should calculate finalized block using blockHeight strategy', async () => {
        const latestBlockNumber = 19000000n;
        mockClient.getBlockNumber.mockResolvedValue(latestBlockNumber);

        const result = await service.getLastFinalizedBlockNumber(testChainId);

        // 19000000 - 64 = 18999936
        expect(result).toBe(18999936n);
        expect(mockClient.getBlockNumber).toHaveBeenCalled();
      });

      it('should return null if calculated block is negative', async () => {
        const latestBlockNumber = 50n; // Less than minBlockHeight
        mockClient.getBlockNumber.mockResolvedValue(latestBlockNumber);

        const result = await service.getLastFinalizedBlockNumber(testChainId);

        expect(result).toBeNull();
      });

      it('should return 0 if latest block equals minBlockHeight', async () => {
        const latestBlockNumber = 64n;
        mockClient.getBlockNumber.mockResolvedValue(latestBlockNumber);

        const result = await service.getLastFinalizedBlockNumber(testChainId);

        // 64 - 64 = 0
        expect(result).toBe(0n);
      });
    });

    it('should return null if RPC call fails gracefully', async () => {
      mockEvmConfig.getFinalityConfig.mockReturnValue({
        type: 'blockTag',
      });
      // getBlockByTag catches errors and returns null
      mockClient.getBlock.mockRejectedValue(new Error('RPC timeout'));

      const result = await service.getLastFinalizedBlockNumber(testChainId);

      expect(result).toBeNull();
    });
  });

  describe('isBlockFinalized', () => {
    describe('with blockTag finality', () => {
      beforeEach(() => {
        mockEvmConfig.getFinalityConfig.mockReturnValue({
          type: 'blockTag',
        });
      });

      it('should return true if block is finalized', async () => {
        const finalizedBlockNumber = 18999990n;
        const testBlockNumber = 18999980n; // Before finalized
        mockClient.getBlock.mockResolvedValue(
          createMockBlock({ number: finalizedBlockNumber })
        );

        const result = await service.isBlockFinalized(
          testBlockNumber,
          testChainId
        );

        expect(result).toBe(true);
      });

      it('should return false if block is not finalized', async () => {
        const finalizedBlockNumber = 18999990n;
        const testBlockNumber = 19000000n; // After finalized
        mockClient.getBlock.mockResolvedValue(
          createMockBlock({ number: finalizedBlockNumber })
        );

        const result = await service.isBlockFinalized(
          testBlockNumber,
          testChainId
        );

        expect(result).toBe(false);
      });

      it('should return true if block equals finalized block', async () => {
        const finalizedBlockNumber = 18999990n;
        mockClient.getBlock.mockResolvedValue(
          createMockBlock({ number: finalizedBlockNumber })
        );

        const result = await service.isBlockFinalized(
          finalizedBlockNumber,
          testChainId
        );

        expect(result).toBe(true);
      });

      it('should return false if finalized block cannot be determined', async () => {
        mockClient.getBlock.mockRejectedValue(
          new Error('Finalized tag not supported')
        );

        const result = await service.isBlockFinalized(19000000n, testChainId);

        expect(result).toBe(false);
      });
    });

    describe('with blockHeight finality', () => {
      beforeEach(() => {
        mockEvmConfig.getFinalityConfig.mockReturnValue({
          type: 'blockHeight',
          minBlockHeight: 64,
        });
      });

      it('should return true if block has enough confirmations', async () => {
        const latestBlockNumber = 19000000n;
        const testBlockNumber = 18999900n; // 100 confirmations
        mockClient.getBlockNumber.mockResolvedValue(latestBlockNumber);

        const result = await service.isBlockFinalized(
          testBlockNumber,
          testChainId
        );

        expect(result).toBe(true);
      });

      it('should return false if block does not have enough confirmations', async () => {
        const latestBlockNumber = 19000000n;
        const testBlockNumber = 18999950n; // 50 confirmations (need 64)
        mockClient.getBlockNumber.mockResolvedValue(latestBlockNumber);

        const result = await service.isBlockFinalized(
          testBlockNumber,
          testChainId
        );

        expect(result).toBe(false);
      });

      it('should return true if block has exactly minBlockHeight confirmations', async () => {
        const latestBlockNumber = 19000000n;
        const testBlockNumber = 18999936n; // Exactly 64 confirmations
        mockClient.getBlockNumber.mockResolvedValue(latestBlockNumber);

        const result = await service.isBlockFinalized(
          testBlockNumber,
          testChainId
        );

        expect(result).toBe(true);
      });
    });

    it('should return false if getLastFinalizedBlockNumber fails gracefully', async () => {
      mockEvmConfig.getFinalityConfig.mockReturnValue({
        type: 'blockTag',
      });
      // getBlockByTag catches errors and returns null, so isBlockFinalized returns false
      mockClient.getBlock.mockRejectedValue(new Error('RPC error'));

      const result = await service.isBlockFinalized(19000000n, testChainId);

      expect(result).toBe(false);
    });
  });
});
