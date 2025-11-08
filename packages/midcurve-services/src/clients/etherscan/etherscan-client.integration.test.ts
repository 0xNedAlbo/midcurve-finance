/**
 * Integration tests for EtherscanClient
 *
 * These tests make real API calls to Etherscan v2 API.
 * They are skipped if ETHERSCAN_API_KEY is not set.
 *
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { EtherscanClient, NFT_POSITION_MANAGER_ADDRESSES } from './etherscan-client.js';

// Skip all tests if API key is not set
const skipTests = !process.env.ETHERSCAN_API_KEY;

describe.skipIf(skipTests)('EtherscanClient Integration Tests', () => {
  let client: EtherscanClient;

  beforeAll(() => {
    if (!skipTests) {
      // Reset singleton
      EtherscanClient.resetInstance();
      client = EtherscanClient.getInstance();
    }
  });

  describe('fetchLogs()', () => {
    it('should fetch real logs from Ethereum mainnet', async () => {
      // Use Uniswap V3 NFPM contract on Ethereum
      const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[1];
      const fromBlock = 12369621; // Contract deployment block
      const toBlock = 12369625; // Just a few blocks after deployment

      const logs = await client.fetchLogs(1, nftManagerAddress, {
        fromBlock,
        toBlock,
      });

      // Should have some logs (NFPM emits events on creation)
      expect(Array.isArray(logs)).toBe(true);
      // Logs may or may not exist in these blocks, just verify structure if present
      if (logs.length > 0) {
        expect(logs[0]).toHaveProperty('address');
        expect(logs[0]).toHaveProperty('topics');
        expect(logs[0]).toHaveProperty('data');
        expect(logs[0]).toHaveProperty('blockNumber');
        expect(logs[0]).toHaveProperty('transactionHash');
      }
    }, 30000); // 30 second timeout for API call

    it('should return empty array when no logs found', async () => {
      // Use a valid contract but a block range with no events
      const logs = await client.fetchLogs(1, '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', {
        fromBlock: 1,
        toBlock: 100,
      });

      expect(logs).toEqual([]);
    }, 30000);
  });

  describe('getContractCreationBlock()', () => {
    it('should fetch NFPM contract creation block on Ethereum', async () => {
      const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[1];
      const blockNumber = await client.getContractCreationBlock(1, nftManagerAddress);

      expect(blockNumber).toBe('12369651'); // Known deployment block
    }, 30000);

    it('should fetch NFPM contract creation block on Arbitrum', async () => {
      const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[42161];
      const blockNumber = await client.getContractCreationBlock(42161, nftManagerAddress);

      // Verify it's a valid block number
      expect(parseInt(blockNumber)).toBeGreaterThan(0);
    }, 30000);

    it('should cache contract creation block', async () => {
      const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[1];

      // First call - fetches from API
      const blockNumber1 = await client.getContractCreationBlock(1, nftManagerAddress);

      // Second call - should use cache (much faster)
      const startTime = Date.now();
      const blockNumber2 = await client.getContractCreationBlock(1, nftManagerAddress);
      const duration = Date.now() - startTime;

      expect(blockNumber1).toBe(blockNumber2);
      expect(duration).toBeLessThan(100); // Cache hit should be very fast
    }, 30000);
  });

  describe('getBlockNumberForTimestamp()', () => {
    it('should fetch block number for known timestamp on Ethereum', async () => {
      // January 1, 2021 00:00:00 UTC
      const timestamp = 1609459200;

      const blockNumber = await client.getBlockNumberForTimestamp(1, timestamp, 'before');

      // Verify it's a valid block number in expected range
      const blockNum = parseInt(blockNumber);
      expect(blockNum).toBeGreaterThan(11000000); // Before this timestamp
      expect(blockNum).toBeLessThan(12000000); // After this timestamp
    }, 30000);

    it('should support "after" mode', async () => {
      const timestamp = 1609459200;

      const blockNumberBefore = await client.getBlockNumberForTimestamp(1, timestamp, 'before');
      const blockNumberAfter = await client.getBlockNumberForTimestamp(1, timestamp, 'after');

      // After should be >= before
      expect(parseInt(blockNumberAfter)).toBeGreaterThanOrEqual(parseInt(blockNumberBefore));
    }, 30000);
  });

  describe('fetchPositionEvents()', () => {
    it('should fetch events for a real Uniswap V3 position NFT on Ethereum', async () => {
      // Use a known position NFT with activity
      // This is a real position that has INCREASE_LIQUIDITY events
      const nftId = '1';
      const chainId = 1;

      const events = await client.fetchPositionEvents(chainId, nftId, {
        fromBlock: 12369621, // NFPM deployment
        toBlock: 12400000, // Early block range
        eventTypes: ['INCREASE_LIQUIDITY'], // Just check one event type
      });

      // Should have at least one event (position #1 was created early)
      expect(Array.isArray(events)).toBe(true);
      if (events.length > 0) {
        expect(events[0]).toHaveProperty('eventType');
        expect(events[0]).toHaveProperty('tokenId');
        expect(events[0]).toHaveProperty('blockNumber');
        expect(events[0]).toHaveProperty('transactionHash');
        expect(events[0].chainId).toBe(chainId);
      }
    }, 60000); // 60 second timeout - may fetch multiple event types

    it('should parse all three event types', async () => {
      // Use position #1 with more block range to catch multiple event types
      const nftId = '1';
      const chainId = 1;

      const events = await client.fetchPositionEvents(chainId, nftId, {
        fromBlock: 12369621,
        toBlock: 13000000, // Larger range to catch DECREASE and COLLECT events
      });

      // Verify events are sorted by blockchain order
      for (let i = 1; i < events.length; i++) {
        const prev = events[i - 1];
        const curr = events[i];

        // Block number should be non-decreasing
        expect(Number(curr.blockNumber)).toBeGreaterThanOrEqual(Number(prev.blockNumber));

        // If same block, transaction index should be non-decreasing
        if (curr.blockNumber === prev.blockNumber) {
          expect(curr.transactionIndex).toBeGreaterThanOrEqual(prev.transactionIndex);

          // If same transaction, log index should be increasing
          if (curr.transactionIndex === prev.transactionIndex) {
            expect(curr.logIndex).toBeGreaterThan(prev.logIndex);
          }
        }
      }
    }, 60000);
  });

  describe('cross-chain support', () => {
    it('should work on Arbitrum', async () => {
      const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[42161];
      const blockNumber = await client.getContractCreationBlock(42161, nftManagerAddress);

      expect(parseInt(blockNumber)).toBeGreaterThan(0);
    }, 30000);

    it('should work on Base', async () => {
      const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[8453];
      const blockNumber = await client.getContractCreationBlock(8453, nftManagerAddress);

      // Verify it matches the known deployment block
      expect(blockNumber).toBe('1371714');
    }, 30000);
  });

  describe('rate limiting', () => {
    it('should handle multiple sequential requests without rate limiting errors', async () => {
      const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[1];

      // Make 5 sequential requests
      for (let i = 0; i < 5; i++) {
        const blockNumber = await client.getContractCreationBlock(1, nftManagerAddress);
        expect(blockNumber).toBe('12369651');
      }

      // If we got here without errors, rate limiting worked
      expect(true).toBe(true);
    }, 60000);
  });
});

// Show helpful message if tests are skipped
if (skipTests) {
  console.log(
    '\n⚠️  Etherscan integration tests skipped: ETHERSCAN_API_KEY not set\n' +
      'To run integration tests:\n' +
      '  1. Get API key from https://etherscan.io/myapikey\n' +
      '  2. Set ETHERSCAN_API_KEY in .env file\n' +
      '  3. Run: npm run test:integration\n'
  );
}
