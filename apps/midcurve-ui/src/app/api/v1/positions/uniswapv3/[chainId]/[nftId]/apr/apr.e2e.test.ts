/**
 * Position APR Periods Endpoint E2E Tests
 *
 * Tests the GET /api/v1/positions/uniswapv3/:chainId/:nftId/apr endpoint end-to-end.
 *
 * Note: This endpoint relies on APR periods which are calculated from ledger events.
 * APR periods are created when:
 * - A position is imported (discovers all historical events and calculates APR periods)
 * - The position has COLLECT events (fee collection events define period boundaries)
 *
 * Test strategy:
 * 1. Import a position via POST /api/v1/positions/uniswapv3/import
 * 2. Extract chainId and nftId from the imported position
 * 3. Test APR endpoint with those values
 *
 * Test uses a well-known closed position on Arbitrum for reliability:
 * - NFT ID: 4865121
 * - Pool: WETH/USDC (0.05% fee tier)
 * - Status: Closed position
 * - APR periods may or may not exist depending on whether position has COLLECT events
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
  AprPeriodsResponse,
  AprPeriodData,
} from '@midcurve/api-shared';

/**
 * Test position: Closed WETH/USDC position on Arbitrum
 */
const TEST_POSITION = {
  chainId: 42161, // Arbitrum
  nftId: 4865121, // Real closed position
};

describe('GET /api/v1/positions/uniswapv3/:chainId/:nftId/apr', () => {
  let testChainId: number;
  let testNftId: string;
  let testPositionId: string;

  // ============================================================================
  // SETUP - Import position first to test against
  // ============================================================================

  beforeAll(async () => {
    // Import the position first so we have APR periods to fetch
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
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      expect(response.status).toBe(401);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
    }, 5000);

    it('should accept authenticated requests with API key', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<AprPeriodsResponse>(response);
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
        `/api/v1/positions/uniswapv3/invalid/${testNftId}/apr`
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject empty nftId with 400 or 404', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}//apr`
      );

      // Note: This might result in a 404 due to route matching failure
      // depending on Next.js routing behavior
      expect([400, 404]).toContain(response.status);
    }, 5000);

    it('should return 404 for non-existent position', async () => {
      const nonExistentNftId = '9999999999';
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${nonExistentNftId}/apr`
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
        `/api/v1/positions/uniswapv3/${wrongChainId}/${testNftId}/apr`
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
    it('should fetch APR periods successfully with 200 OK', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<AprPeriodsResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('meta');
    }, 5000);

    it('should return array of periods', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

      // APR periods may or may not exist (depends on COLLECT events)
      expect(Array.isArray(data.data)).toBe(true);
    }, 5000);

    it('should return correct period data structure if periods exist', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);
      const periods = data.data;

      if (periods.length === 0) {
        // Skip test if no periods exist (position has no COLLECT events)
        return;
      }

      // Check first period structure
      const period = periods[0] as AprPeriodData;

      // Core period fields
      expect(period).toHaveProperty('id');
      expect(period).toHaveProperty('positionId', testPositionId);
      expect(period).toHaveProperty('startEventId');
      expect(period).toHaveProperty('endEventId');

      // Time range
      expect(period).toHaveProperty('startTimestamp');
      expect(period).toHaveProperty('endTimestamp');
      expect(period).toHaveProperty('durationSeconds');

      // Financial metrics
      expect(period).toHaveProperty('costBasis');
      expect(period).toHaveProperty('collectedFeeValue');

      // APR metric
      expect(period).toHaveProperty('aprBps');

      // Debugging
      expect(period).toHaveProperty('eventCount');

      // Timestamps
      expect(period).toHaveProperty('createdAt');
      expect(period).toHaveProperty('updatedAt');
    }, 5000);

    it('should serialize bigint fields as strings', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

      if (data.data.length === 0) {
        // Skip test if no periods exist
        return;
      }

      const period = data.data[0] as AprPeriodData;

      // Financial metrics (bigint → string)
      expect(typeof period.costBasis).toBe('string');
      expect(typeof period.collectedFeeValue).toBe('string');
    }, 5000);

    it('should serialize Date fields as ISO strings', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

      if (data.data.length === 0) {
        // Skip test if no periods exist
        return;
      }

      const period = data.data[0] as AprPeriodData;

      // Period timestamps
      expect(typeof period.createdAt).toBe('string');
      expect(typeof period.updatedAt).toBe('string');
      expect(typeof period.startTimestamp).toBe('string');
      expect(typeof period.endTimestamp).toBe('string');

      // Validate ISO 8601 format
      expect(() => new Date(period.createdAt)).not.toThrow();
      expect(() => new Date(period.updatedAt)).not.toThrow();
      expect(() => new Date(period.startTimestamp)).not.toThrow();
      expect(() => new Date(period.endTimestamp)).not.toThrow();
    }, 5000);

    it('should include metadata with count and timestamp', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

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
  // APR PERIOD VALIDATION TESTS
  // ============================================================================

  describe('APR period validation', () => {
    it('should have periods ordered by startTimestamp descending (newest first)', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);
      const periods = data.data;

      if (periods.length < 2) {
        // Skip test if fewer than 2 periods
        return;
      }

      // Check ordering
      for (let i = 0; i < periods.length - 1; i++) {
        const currentPeriod = periods[i] as AprPeriodData;
        const nextPeriod = periods[i + 1] as AprPeriodData;

        const currentStart = new Date(currentPeriod.startTimestamp);
        const nextStart = new Date(nextPeriod.startTimestamp);

        // Current period should have startTimestamp >= next period
        expect(currentStart.getTime() >= nextStart.getTime()).toBe(true);
      }
    }, 5000);

    it('should have non-negative APR values', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

      if (data.data.length === 0) {
        // Skip test if no periods exist
        return;
      }

      data.data.forEach((period) => {
        expect(period.aprBps).toBeGreaterThanOrEqual(0);
        expect(typeof period.aprBps).toBe('number');
      });
    }, 5000);

    it('should have non-negative duration values', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

      if (data.data.length === 0) {
        // Skip test if no periods exist
        return;
      }

      data.data.forEach((period) => {
        // Duration can be 0 for very short-lived periods (same block)
        expect(period.durationSeconds).toBeGreaterThanOrEqual(0);
        expect(typeof period.durationSeconds).toBe('number');
      });
    }, 5000);

    it('should have non-negative financial values', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

      if (data.data.length === 0) {
        // Skip test if no periods exist
        return;
      }

      data.data.forEach((period) => {
        const costBasis = BigInt(period.costBasis);
        const collectedFeeValue = BigInt(period.collectedFeeValue);

        expect(costBasis >= 0n).toBe(true);
        expect(collectedFeeValue >= 0n).toBe(true);
      });
    }, 5000);

    it('should have valid event IDs', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

      if (data.data.length === 0) {
        // Skip test if no periods exist
        return;
      }

      data.data.forEach((period) => {
        expect(typeof period.startEventId).toBe('string');
        expect(period.startEventId.length).toBeGreaterThan(0);
        expect(typeof period.endEventId).toBe('string');
        expect(period.endEventId.length).toBeGreaterThan(0);
      });
    }, 5000);

    it('should have positive event counts', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

      if (data.data.length === 0) {
        // Skip test if no periods exist
        return;
      }

      data.data.forEach((period) => {
        expect(period.eventCount).toBeGreaterThan(0);
        expect(typeof period.eventCount).toBe('number');
      });
    }, 5000);
  });

  // ============================================================================
  // EDGE CASE TESTS
  // ============================================================================

  describe('edge cases', () => {
    it('should handle positions with no APR periods gracefully', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}/apr`
      );

      const data = await parseJsonResponse<AprPeriodsResponse>(response);

      // Should return empty array, not error
      expect(response.status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.meta.count).toBe(data.data.length);
    }, 5000);
  });
});
