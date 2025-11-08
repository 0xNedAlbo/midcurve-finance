/**
 * Tests for EtherscanClient
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { DeepMockProxy } from 'vitest-mock-extended';
import {
  EtherscanClient,
  EtherscanApiError,
  EtherscanApiKeyMissingError,
  EVENT_SIGNATURES,
  NFT_POSITION_MANAGER_ADDRESSES,
} from './etherscan-client.js';
import type {
  EtherscanLog,
  EtherscanLogsResponse,
  EtherscanBlockNumberResponse,
  EtherscanContractCreationResponse,
  RawPositionEvent,
} from './types.js';
import { CacheService } from '../../services/cache/index.js';
import { RequestScheduler } from '../../utils/request-scheduler/index.js';

describe('EtherscanClient', () => {
  let client: EtherscanClient;
  let fetchMock: ReturnType<typeof vi.fn>;
  let cacheServiceMock: DeepMockProxy<CacheService>;
  let requestSchedulerMock: DeepMockProxy<RequestScheduler>;

  // Store original env var
  const originalApiKey = process.env.ETHERSCAN_API_KEY;

  beforeEach(() => {
    // Set API key for tests
    process.env.ETHERSCAN_API_KEY = 'test-api-key';

    // Reset singleton before each test
    EtherscanClient.resetInstance();

    // Mock CacheService
    cacheServiceMock = mockDeep<CacheService>();
    cacheServiceMock.get.mockResolvedValue(null);
    cacheServiceMock.set.mockResolvedValue(true);

    // Mock RequestScheduler to execute tasks immediately
    requestSchedulerMock = mockDeep<RequestScheduler>();
    requestSchedulerMock.schedule.mockImplementation(async (task) => {
      return await task();
    });

    // Create client with mocked dependencies
    client = new EtherscanClient({
      cacheService: cacheServiceMock,
      requestScheduler: requestSchedulerMock,
      apiKey: 'test-api-key',
    });

    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original API key
    if (originalApiKey !== undefined) {
      process.env.ETHERSCAN_API_KEY = originalApiKey;
    } else {
      delete process.env.ETHERSCAN_API_KEY;
    }
  });

  describe('constructor', () => {
    it('should throw error if API key is missing', () => {
      delete process.env.ETHERSCAN_API_KEY;
      expect(() => new EtherscanClient()).toThrow(EtherscanApiKeyMissingError);
    });

    it('should use provided API key', () => {
      const customClient = new EtherscanClient({ apiKey: 'custom-key' });
      expect(customClient).toBeInstanceOf(EtherscanClient);
    });

    it('should use environment variable API key', () => {
      process.env.ETHERSCAN_API_KEY = 'env-key';
      const customClient = new EtherscanClient();
      expect(customClient).toBeInstanceOf(EtherscanClient);
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = EtherscanClient.getInstance();
      const instance2 = EtherscanClient.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = EtherscanClient.getInstance();
      EtherscanClient.resetInstance();
      const instance2 = EtherscanClient.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('getSupportedChainIds()', () => {
    it('should return supported chain IDs', () => {
      const chainIds = client.getSupportedChainIds();
      expect(chainIds).toEqual([1, 42161, 8453, 10, 137]);
    });
  });

  describe('isChainSupported()', () => {
    it('should return true for supported chains', () => {
      expect(client.isChainSupported(1)).toBe(true);
      expect(client.isChainSupported(42161)).toBe(true);
      expect(client.isChainSupported(8453)).toBe(true);
    });

    it('should return false for unsupported chains', () => {
      expect(client.isChainSupported(999)).toBe(false);
      expect(client.isChainSupported(56)).toBe(false);
    });
  });

  describe('fetchLogs()', () => {
    const mockLogs: EtherscanLog[] = [
      {
        address: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
        topics: [
          EVENT_SIGNATURES.INCREASE_LIQUIDITY,
          '0x0000000000000000000000000000000000000000000000000000000000000001',
        ],
        data: '0x00000000000000000000000000000000000000000000000000000000000186a000000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000001e8480',
        blockNumber: '12345678',
        blockHash: '0xabc...',
        timeStamp: '1609459200',
        gasPrice: '50000000000',
        gasUsed: '100000',
        logIndex: '0',
        transactionHash: '0xdef...',
        transactionIndex: '0',
      },
    ];

    it('should fetch logs successfully', async () => {
      const mockResponse: EtherscanLogsResponse = {
        status: '1',
        message: 'OK',
        result: mockLogs,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      const logs = await client.fetchLogs(1, '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', {
        fromBlock: 12000000,
        toBlock: 13000000,
        topic0: EVENT_SIGNATURES.INCREASE_LIQUIDITY,
      });

      expect(logs).toEqual(mockLogs);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no records found', async () => {
      const mockResponse: EtherscanLogsResponse = {
        status: '0',
        message: 'No records found',
        result: 'No records found',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      const logs = await client.fetchLogs(1, '0xC36442b4a4522E871399CD717aBDD847Ab11FE88');
      expect(logs).toEqual([]);
    });

    it('should throw error for unsupported chain', async () => {
      await expect(
        client.fetchLogs(999, '0xC36442b4a4522E871399CD717aBDD847Ab11FE88')
      ).rejects.toThrow(EtherscanApiError);
    });

    it('should throw error for API error response', async () => {
      const mockResponse: EtherscanLogsResponse = {
        status: '0',
        message: 'NOTOK',
        result: 'Error! Invalid API Key',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      await expect(
        client.fetchLogs(1, '0xC36442b4a4522E871399CD717aBDD847Ab11FE88')
      ).rejects.toThrow(EtherscanApiError);
    });

    it('should throw error for HTTP error', async () => {
      // Use 400 Bad Request (non-retryable) to avoid retry loop
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers(),
      });

      await expect(
        client.fetchLogs(1, '0xC36442b4a4522E871399CD717aBDD847Ab11FE88')
      ).rejects.toThrow(EtherscanApiError);
    });
  });

  describe('getContractCreationBlock()', () => {
    const mockCreationInfo = {
      contractAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
      contractCreator: '0x123...',
      txHash: '0xabc...',
      blockNumber: '12369621',
    };

    it('should fetch contract creation block successfully', async () => {
      const mockResponse: EtherscanContractCreationResponse = {
        status: '1',
        message: 'OK',
        result: [mockCreationInfo],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      const blockNumber = await client.getContractCreationBlock(
        1,
        '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
      );

      expect(blockNumber).toBe('12369621');
      expect(cacheServiceMock.set).toHaveBeenCalledWith(
        'etherscan:contract-creation:1:0xc36442b4a4522e871399cd717abdd847ab11fe88',
        mockCreationInfo,
        expect.any(Number)
      );
    });

    it('should return cached value if available', async () => {
      cacheServiceMock.get.mockResolvedValue(mockCreationInfo);

      const blockNumber = await client.getContractCreationBlock(
        1,
        '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
      );

      expect(blockNumber).toBe('12369621');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should throw error if contract not found', async () => {
      const mockResponse: EtherscanContractCreationResponse = {
        status: '1',
        message: 'OK',
        result: [],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      await expect(
        client.getContractCreationBlock(1, '0xC36442b4a4522E871399CD717aBDD847Ab11FE88')
      ).rejects.toThrow(EtherscanApiError);
    });
  });

  describe('getBlockNumberForTimestamp()', () => {
    it('should fetch block number for timestamp successfully', async () => {
      const mockResponse: EtherscanBlockNumberResponse = {
        status: '1',
        message: 'OK',
        result: '12345678',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      const blockNumber = await client.getBlockNumberForTimestamp(1, 1609459200);

      expect(blockNumber).toBe('12345678');
    });

    it('should handle "before" and "after" closest parameter', async () => {
      const mockResponse: EtherscanBlockNumberResponse = {
        status: '1',
        message: 'OK',
        result: '12345678',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      await client.getBlockNumberForTimestamp(1, 1609459200, 'after');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should throw error for invalid timestamp', async () => {
      const mockResponse: EtherscanBlockNumberResponse = {
        status: '0',
        message: 'NOTOK',
        result: 'Error! Invalid timestamp',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      await expect(client.getBlockNumberForTimestamp(1, 0)).rejects.toThrow(EtherscanApiError);
    });
  });

  describe('fetchPositionEvents()', () => {
    const nftId = '123456';
    const chainId = 1;

    beforeEach(() => {
      // Mock contract creation block
      cacheServiceMock.get.mockResolvedValue({
        contractAddress: NFT_POSITION_MANAGER_ADDRESSES[chainId],
        contractCreator: '0x123...',
        txHash: '0xabc...',
        blockNumber: '12369621',
      });
    });

    it('should fetch and parse INCREASE_LIQUIDITY event', async () => {
      const mockLog: EtherscanLog = {
        address: NFT_POSITION_MANAGER_ADDRESSES[chainId],
        topics: [
          EVENT_SIGNATURES.INCREASE_LIQUIDITY,
          '0x000000000000000000000000000000000000000000000000000000000001e240', // tokenId = 123456
        ],
        data:
          '0x' +
          '00000000000000000000000000000000000000000000000000000000000186a0' + // liquidity
          '00000000000000000000000000000000000000000000000000000000000f4240' + // amount0
          '00000000000000000000000000000000000000000000000000000000001e8480', // amount1
        blockNumber: '12345678',
        blockHash: '0xabc...',
        timeStamp: '1609459200',
        gasPrice: '50000000000',
        gasUsed: '100000',
        logIndex: '0',
        transactionHash: '0xdef...',
        transactionIndex: '0',
      };

      const mockResponse: EtherscanLogsResponse = {
        status: '1',
        message: 'OK',
        result: [mockLog],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      const events = await client.fetchPositionEvents(chainId, nftId);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: '123456',
        liquidity: '100000',
        amount0: '1000000',
        amount1: '2000000',
        blockNumber: 12345678n,
        transactionIndex: 0,
        logIndex: 0,
        chainId: 1,
      });
    });

    it('should fetch and parse DECREASE_LIQUIDITY event', async () => {
      const mockLog: EtherscanLog = {
        address: NFT_POSITION_MANAGER_ADDRESSES[chainId],
        topics: [
          EVENT_SIGNATURES.DECREASE_LIQUIDITY,
          '0x000000000000000000000000000000000000000000000000000000000001e240',
        ],
        data:
          '0x' +
          '00000000000000000000000000000000000000000000000000000000000186a0' + // liquidity
          '00000000000000000000000000000000000000000000000000000000000f4240' + // amount0
          '00000000000000000000000000000000000000000000000000000000001e8480', // amount1
        blockNumber: '12345679',
        blockHash: '0xabc...',
        timeStamp: '1609459300',
        gasPrice: '50000000000',
        gasUsed: '100000',
        logIndex: '1',
        transactionHash: '0xghi...',
        transactionIndex: '1',
      };

      const mockResponse: EtherscanLogsResponse = {
        status: '1',
        message: 'OK',
        result: [mockLog],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      const events = await client.fetchPositionEvents(chainId, nftId, {
        eventTypes: ['DECREASE_LIQUIDITY'],
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: '123456',
        liquidity: '100000',
        amount0: '1000000',
        amount1: '2000000',
      });
    });

    it('should fetch and parse COLLECT event', async () => {
      const mockLog: EtherscanLog = {
        address: NFT_POSITION_MANAGER_ADDRESSES[chainId],
        topics: [
          EVENT_SIGNATURES.COLLECT,
          '0x000000000000000000000000000000000000000000000000000000000001e240',
        ],
        data:
          '0x' +
          '000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' + // recipient
          '00000000000000000000000000000000000000000000000000000000000f4240' + // amount0
          '00000000000000000000000000000000000000000000000000000000001e8480', // amount1
        blockNumber: '12345680',
        blockHash: '0xabc...',
        timeStamp: '1609459400',
        gasPrice: '50000000000',
        gasUsed: '100000',
        logIndex: '2',
        transactionHash: '0xjkl...',
        transactionIndex: '2',
      };

      const mockResponse: EtherscanLogsResponse = {
        status: '1',
        message: 'OK',
        result: [mockLog],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      const events = await client.fetchPositionEvents(chainId, nftId, {
        eventTypes: ['COLLECT'],
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'COLLECT',
        tokenId: '123456',
        recipient: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        amount0: '1000000',
        amount1: '2000000',
      });
    });

    it('should deduplicate events with same txHash and logIndex', async () => {
      const mockLog: EtherscanLog = {
        address: NFT_POSITION_MANAGER_ADDRESSES[chainId],
        topics: [
          EVENT_SIGNATURES.INCREASE_LIQUIDITY,
          '0x000000000000000000000000000000000000000000000000000000000001e240',
        ],
        data:
          '0x' +
          '00000000000000000000000000000000000000000000000000000000000186a0' +
          '00000000000000000000000000000000000000000000000000000000000f4240' +
          '00000000000000000000000000000000000000000000000000000000001e8480',
        blockNumber: '12345678',
        blockHash: '0xabc...',
        timeStamp: '1609459200',
        gasPrice: '50000000000',
        gasUsed: '100000',
        logIndex: '0',
        transactionHash: '0xdef...',
        transactionIndex: '0',
      };

      const mockResponse: EtherscanLogsResponse = {
        status: '1',
        message: 'OK',
        result: [mockLog, mockLog], // Duplicate
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      const events = await client.fetchPositionEvents(chainId, nftId);

      expect(events).toHaveLength(1);
    });

    it('should sort events by blockchain order', async () => {
      const mockLogs: EtherscanLog[] = [
        {
          address: NFT_POSITION_MANAGER_ADDRESSES[chainId],
          topics: [
            EVENT_SIGNATURES.INCREASE_LIQUIDITY,
            '0x000000000000000000000000000000000000000000000000000000000001e240',
          ],
          data:
            '0x' +
            '00000000000000000000000000000000000000000000000000000000000186a0' +
            '00000000000000000000000000000000000000000000000000000000000f4240' +
            '00000000000000000000000000000000000000000000000000000000001e8480',
          blockNumber: '12345680', // Later block
          blockHash: '0xabc...',
          timeStamp: '1609459400',
          gasPrice: '50000000000',
          gasUsed: '100000',
          logIndex: '0',
          transactionHash: '0xghi...',
          transactionIndex: '0',
        },
        {
          address: NFT_POSITION_MANAGER_ADDRESSES[chainId],
          topics: [
            EVENT_SIGNATURES.INCREASE_LIQUIDITY,
            '0x000000000000000000000000000000000000000000000000000000000001e240',
          ],
          data:
            '0x' +
            '00000000000000000000000000000000000000000000000000000000000186a0' +
            '00000000000000000000000000000000000000000000000000000000000f4240' +
            '00000000000000000000000000000000000000000000000000000000001e8480',
          blockNumber: '12345678', // Earlier block
          blockHash: '0xabc...',
          timeStamp: '1609459200',
          gasPrice: '50000000000',
          gasUsed: '100000',
          logIndex: '0',
          transactionHash: '0xdef...',
          transactionIndex: '0',
        },
      ];

      const mockResponse: EtherscanLogsResponse = {
        status: '1',
        message: 'OK',
        result: mockLogs,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      const events = await client.fetchPositionEvents(chainId, nftId);

      expect(events).toHaveLength(2);
      expect(events[0].blockNumber).toBe(12345678n); // Earlier block first
      expect(events[1].blockNumber).toBe(12345680n);
    });

    it('should use provided fromBlock and toBlock', async () => {
      const mockResponse: EtherscanLogsResponse = {
        status: '1',
        message: 'OK',
        result: [],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      await client.fetchPositionEvents(chainId, nftId, {
        fromBlock: 12000000,
        toBlock: 13000000,
      });

      expect(fetchMock).toHaveBeenCalled();
      // Verify fromBlock and toBlock are used in URL
      const callUrl = fetchMock.mock.calls[0][0];
      expect(callUrl).toContain('fromBlock=12000000');
      expect(callUrl).toContain('toBlock=13000000');
    });
  });

  describe('rate limiting and retry', () => {
    it('should use RequestScheduler for all API calls', async () => {
      const mockResponse: EtherscanLogsResponse = {
        status: '1',
        message: 'OK',
        result: [],
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
        headers: new Headers(),
      });

      await client.fetchLogs(1, '0xC36442b4a4522E871399CD717aBDD847Ab11FE88');

      expect(requestSchedulerMock.schedule).toHaveBeenCalled();
    });
  });
});
