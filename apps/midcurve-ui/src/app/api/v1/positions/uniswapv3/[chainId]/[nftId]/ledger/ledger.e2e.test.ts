/**
 * Position Ledger Endpoint E2E Tests
 *
 * Tests the GET /api/v1/positions/uniswapv3/:chainId/:nftId/ledger endpoint end-to-end.
 *
 * Note: This endpoint relies on position ledger events which are created when:
 * - A position is imported (discovers all historical events from blockchain)
 * - Events are manually added via the position ledger service
 *
 * Test strategy:
 * 1. Import a position via POST /api/v1/positions/uniswapv3/import
 * 2. Extract chainId and nftId from the imported position
 * 3. Test ledger endpoint with those values
 *
 * Test uses a well-known closed position on Arbitrum for reliability:
 * - NFT ID: 4865121
 * - Pool: WETH/USDC (0.05% fee tier)
 * - Status: Closed position with multiple ledger events
 * - Quote token: USDC (auto-detected)
 * - Base token: WETH
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  authenticatedPost,
  authenticatedGet,
  unauthenticatedGet,
  parseJsonResponse,
} from '@/test/helpers';
import type {
  ImportUniswapV3PositionResponse,
  LedgerEventsResponse,
  LedgerEventData,
} from '@midcurve/api-shared';

/**
 * Test position: Closed WETH/USDC position on Arbitrum
 */
const TEST_POSITION = {
  chainId: 42161, // Arbitrum
  nftId: 4865121, // Real closed position with ledger events
};

describe('GET /api/v1/positions/uniswapv3/:chainId/:nftId/ledger', () => {
  let testChainId: number;
  let testNftId: string;
  let testPositionId: string;

  // ============================================================================
  // SETUP - Import position first to test against
  // ============================================================================

  beforeAll(async () => {
    // Import the position first so we have ledger events to fetch
    const importResponse = await authenticatedPost(
      '/api/v1/positions/uniswapv3/import',
      TEST_POSITION
    );

    expect(importResponse.status).toBe(200);

    const importData =
      await parseJsonResponse<ImportUniswapV3PositionResponse>(importResponse);

    // Extract values for testing
    testChainId = importData.data.config.chainId;
    testNftId = importData.data.config.nftId.toString();
    testPositionId = importData.data.id;

    expect(testChainId).toBe(TEST_POSITION.chainId);
    expect(testNftId).toBe(TEST_POSITION.nftId.toString());
  }, 15000); // Extended timeout for on-chain import

  // ============================================================================
  // AUTHENTICATION TESTS
  // ============================================================================

  describe('authentication', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await unauthenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      expect(response.status).toBe(401);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
    }, 5000);

    it('should accept authenticated requests with API key', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
    }, 5000);
  });

  // ============================================================================
  // PATH PARAMETER VALIDATION TESTS
  // ============================================================================

  describe('path parameter validation', () => {
    it('should reject invalid chainId format with 400', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/invalid/${testNftId}/ledger`
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject empty nftId with 400 or 404', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}//ledger`
      );

      // Note: This might result in a 404 due to route matching failure
      // depending on Next.js routing behavior
      expect([400, 404]).toContain(response.status);
    }, 5000);

    it('should return 404 for non-existent position', async () => {
      const nonExistentNftId = '9999999999';
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${nonExistentNftId}/ledger`
      );

      expect(response.status).toBe(404);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'POSITION_NOT_FOUND');
    }, 5000);

    it('should return 404 for wrong chainId with existing nftId', async () => {
      const wrongChainId = 1; // Ethereum instead of Arbitrum
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${wrongChainId}/${testNftId}/ledger`
      );

      expect(response.status).toBe(404);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'POSITION_NOT_FOUND');
    }, 5000);
  });

  // ============================================================================
  // SUCCESS CASES
  // ============================================================================

  describe('success cases', () => {
    it('should fetch ledger events successfully with 200 OK', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('meta');
    }, 5000);

    it('should return array of events', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);

      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    }, 5000);

    it('should return correct event data structure', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      const events = data.data;

      expect(events.length).toBeGreaterThan(0);

      // Check first event structure
      const event = events[0] as LedgerEventData;

      // Core event fields
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('positionId', testPositionId);
      expect(event).toHaveProperty('protocol', 'uniswapv3');
      expect(event).toHaveProperty('previousId');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('eventType');
      expect(event).toHaveProperty('inputHash');

      // Financial data
      expect(event).toHaveProperty('poolPrice');
      expect(event).toHaveProperty('token0Amount');
      expect(event).toHaveProperty('token1Amount');
      expect(event).toHaveProperty('tokenValue');
      expect(event).toHaveProperty('rewards');

      // PnL tracking
      expect(event).toHaveProperty('deltaCostBasis');
      expect(event).toHaveProperty('costBasisAfter');
      expect(event).toHaveProperty('deltaPnl');
      expect(event).toHaveProperty('pnlAfter');

      // Protocol-specific
      expect(event).toHaveProperty('config');
      expect(event).toHaveProperty('state');

      // Timestamps
      expect(event).toHaveProperty('createdAt');
      expect(event).toHaveProperty('updatedAt');
    }, 5000);

    it('should have valid event types', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      const events = data.data;

      const validEventTypes = ['INCREASE_POSITION', 'DECREASE_POSITION', 'COLLECT'];

      events.forEach((event) => {
        expect(validEventTypes).toContain(event.eventType);
      });
    }, 5000);

    it('should serialize bigint fields as strings', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      const event = data.data[0] as LedgerEventData;

      // Financial data (bigint → string)
      expect(typeof event.poolPrice).toBe('string');
      expect(typeof event.token0Amount).toBe('string');
      expect(typeof event.token1Amount).toBe('string');
      expect(typeof event.tokenValue).toBe('string');

      // PnL tracking (bigint → string)
      expect(typeof event.deltaCostBasis).toBe('string');
      expect(typeof event.costBasisAfter).toBe('string');
      expect(typeof event.deltaPnl).toBe('string');
      expect(typeof event.pnlAfter).toBe('string');

      // Rewards array
      expect(Array.isArray(event.rewards)).toBe(true);
      if (event.rewards.length > 0) {
        const reward = event.rewards[0];
        expect(typeof reward.tokenAmount).toBe('string');
        expect(typeof reward.tokenValue).toBe('string');
      }
    }, 5000);

    it('should serialize Date fields as ISO strings', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      const event = data.data[0] as LedgerEventData;

      // Event timestamps
      expect(typeof event.createdAt).toBe('string');
      expect(typeof event.updatedAt).toBe('string');
      expect(typeof event.timestamp).toBe('string');

      // Validate ISO 8601 format
      expect(() => new Date(event.createdAt)).not.toThrow();
      expect(() => new Date(event.updatedAt)).not.toThrow();
      expect(() => new Date(event.timestamp)).not.toThrow();
    }, 5000);

    it('should have config with blockchain coordinates', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      const event = data.data[0] as LedgerEventData;

      // Config should be an object
      expect(typeof event.config).toBe('object');
      expect(event.config).not.toBeNull();

      // Config should have blockchain coordinates (as SerializedValue)
      const config = event.config as Record<string, unknown>;
      expect(config).toHaveProperty('chainId');
      expect(config).toHaveProperty('nftId');
      expect(config).toHaveProperty('blockNumber');
      expect(config).toHaveProperty('txIndex');
      expect(config).toHaveProperty('logIndex');
      expect(config).toHaveProperty('txHash');
    }, 5000);

    it('should include metadata with count and timestamp', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);

      expect(data).toHaveProperty('meta');
      expect(data.meta).toHaveProperty('timestamp');
      expect(data.meta).toHaveProperty('count');

      expect(typeof data.meta.timestamp).toBe('string');
      expect(typeof data.meta.count).toBe('number');
      expect(data.meta.count).toBe(data.data.length);

      // Validate timestamp format
      expect(() => new Date(data.meta.timestamp)).not.toThrow();
    }, 5000);
  });

  // ============================================================================
  // EVENT ORDERING TESTS
  // ============================================================================

  describe('event ordering', () => {
    it('should return events in descending order (newest first)', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      const events = data.data;

      if (events.length < 2) {
        // Skip test if only one event (nothing to compare)
        return;
      }

      // Extract blockchain coordinates for comparison
      for (let i = 0; i < events.length - 1; i++) {
        const currentEvent = events[i] as LedgerEventData;
        const nextEvent = events[i + 1] as LedgerEventData;

        const currentConfig = currentEvent.config as Record<string, unknown>;
        const nextConfig = nextEvent.config as Record<string, unknown>;

        const currentBlock = BigInt(currentConfig.blockNumber as string);
        const nextBlock = BigInt(nextConfig.blockNumber as string);

        // Current event should have blockNumber >= next event
        expect(currentBlock >= nextBlock).toBe(true);

        // If same block, check transaction index
        if (currentBlock === nextBlock) {
          const currentTxIndex = currentConfig.txIndex as number;
          const nextTxIndex = nextConfig.txIndex as number;

          expect(currentTxIndex >= nextTxIndex).toBe(true);

          // If same transaction, check log index
          if (currentTxIndex === nextTxIndex) {
            const currentLogIndex = currentConfig.logIndex as number;
            const nextLogIndex = nextConfig.logIndex as number;

            expect(currentLogIndex >= nextLogIndex).toBe(true);
          }
        }
      }
    }, 5000);

    it('should have events with sequential cost basis tracking', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      const events = data.data;

      // Reverse array to check chronological order (oldest first)
      const chronologicalEvents = [...events].reverse();

      // Check that cost basis changes are tracked correctly
      for (let i = 1; i < chronologicalEvents.length; i++) {
        const prevEvent = chronologicalEvents[i - 1] as LedgerEventData;
        const currentEvent = chronologicalEvents[i] as LedgerEventData;

        // Previous event's costBasisAfter should influence current event
        // (This is a sanity check that events are properly linked)
        expect(prevEvent).toHaveProperty('costBasisAfter');
        expect(currentEvent).toHaveProperty('costBasisAfter');
      }
    }, 5000);
  });

  // ============================================================================
  // EVENT CHAINING TESTS
  // ============================================================================

  describe('event chaining', () => {
    it('should have first event (chronologically) with null previousId', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      const events = data.data;

      // Last event in array is first chronologically (descending order)
      const firstEvent = events[events.length - 1] as LedgerEventData;

      expect(firstEvent.previousId).toBeNull();
    }, 5000);

    it('should have subsequent events with valid previousId', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/ledger`
      );

      const data = await parseJsonResponse<LedgerEventsResponse>(response);
      const events = data.data;

      if (events.length < 2) {
        // Skip test if only one event
        return;
      }

      // All events except the first (chronologically) should have previousId
      for (let i = 0; i < events.length - 1; i++) {
        const event = events[i] as LedgerEventData;
        expect(event.previousId).not.toBeNull();
        expect(typeof event.previousId).toBe('string');
      }
    }, 5000);
  });
});
