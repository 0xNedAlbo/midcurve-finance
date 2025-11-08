/**
 * Position Delete Endpoint E2E Tests
 *
 * Tests the DELETE /api/v1/positions/uniswapv3/:chainId/:nftId endpoint end-to-end.
 *
 * Key feature: This endpoint is IDEMPOTENT - it returns 200 success even if the
 * position doesn't exist or was already deleted.
 *
 * Test strategy:
 * 1. Import a position via POST /api/v1/positions/uniswapv3/import (beforeAll)
 * 2. Extract chainId and nftId from the imported position
 * 3. Test DELETE endpoint authentication and validation
 * 4. Delete the position and verify idempotent behavior
 * 5. Verify position is actually removed from database
 *
 * Test uses a well-known closed position on Arbitrum for reliability:
 * - NFT ID: 4865121
 * - Pool: WETH/USDC (0.05% fee tier)
 * - Status: Closed position (no on-chain state changes)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  authenticatedPost,
  authenticatedGet,
  authenticatedDelete,
  unauthenticatedDelete,
  parseJsonResponse,
  getPrismaClient,
} from '@/test/helpers';
import type {
  ImportUniswapV3PositionResponse,
  DeleteUniswapV3PositionResponse,
} from '@midcurve/api-shared';

/**
 * Test position: Closed WETH/USDC position on Arbitrum
 */
const TEST_POSITION = {
  chainId: 42161, // Arbitrum
  nftId: 4865121, // Real closed position
};

describe('DELETE /api/v1/positions/uniswapv3/:chainId/:nftId', () => {
  let testChainId: number;
  let testNftId: string;
  let testPositionId: string;

  // ============================================================================
  // SETUP - Import position first to test deletion
  // ============================================================================

  beforeAll(async () => {
    // Import the position first so we have something to delete
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
      const response = await unauthenticatedDelete(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      expect(response.status).toBe(401);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'UNAUTHORIZED');
    }, 5000);

    it('should accept authenticated requests with API key', async () => {
      // Note: This will actually delete the position, but that's okay because
      // we test idempotency next
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<DeleteUniswapV3PositionResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toEqual({});
    }, 5000);
  });

  // ============================================================================
  // PATH PARAMETER VALIDATION TESTS
  // ============================================================================

  describe('path parameter validation', () => {
    it('should reject invalid chainId format with 400', async () => {
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/invalid/${testNftId}`
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject invalid nftId format with 400', async () => {
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/${testChainId}/invalid`
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject negative chainId with 400', async () => {
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/-1/${testNftId}`
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject negative nftId with 400', async () => {
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/${testChainId}/-1`
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject zero chainId with 400', async () => {
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/0/${testNftId}`
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject zero nftId with 400', async () => {
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/${testChainId}/0`
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);
  });

  // ============================================================================
  // IDEMPOTENCY & SUCCESS TESTS
  // ============================================================================

  describe('idempotency and success cases', () => {
    it('should be idempotent - return 200 when deleting already-deleted position', async () => {
      // The position was already deleted in the authentication test above
      // This verifies idempotent behavior
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<DeleteUniswapV3PositionResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toEqual({});
      expect(data).toHaveProperty('meta');
      expect(data.meta).toHaveProperty('timestamp');
    }, 5000);

    it('should verify position is actually deleted from database', async () => {
      const prisma = getPrismaClient();

      try {
        const position = await prisma.position.findUnique({
          where: { id: testPositionId },
        });

        expect(position).toBeNull();
      } finally {
        await prisma.$disconnect();
      }
    }, 5000);

    it('should return 404 when trying to GET deleted position', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      expect(response.status).toBe(404);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'POSITION_NOT_FOUND');
    }, 5000);

    it('should return 200 for non-existent position (idempotent)', async () => {
      const nonExistentNftId = '9999999999';
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/${testChainId}/${nonExistentNftId}`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<DeleteUniswapV3PositionResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toEqual({});
    }, 5000);

    it('should return 200 for wrong chainId (idempotent)', async () => {
      const wrongChainId = 1; // Ethereum instead of Arbitrum
      const response = await authenticatedDelete(
        `/api/v1/positions/uniswapv3/${wrongChainId}/${testNftId}`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<DeleteUniswapV3PositionResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toEqual({});
    }, 5000);
  });
});
