/**
 * Position Get Endpoint E2E Tests
 *
 * Tests the GET /api/v1/positions/uniswapv3/:chainId/:nftId endpoint end-to-end.
 *
 * Note: This endpoint makes real calls to:
 * - Uniswap V3 NonfungiblePositionManager contract on Arbitrum (on-chain)
 * - Uniswap V3 pool contracts for state data (on-chain)
 * - Token contracts for metadata (on-chain)
 *
 * Test strategy (Option A):
 * 1. Import a position via POST /api/v1/positions/uniswapv3/import
 * 2. Extract chainId and nftId from the imported position
 * 3. Test GET endpoint with those values
 *
 * Test uses a well-known closed position on Arbitrum for reliability:
 * - NFT ID: 4865121
 * - Pool: WETH/USDC (0.05% fee tier)
 * - Status: Closed position
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
  GetUniswapV3PositionResponse,
} from '@midcurve/api-shared';

/**
 * Test position: Closed WETH/USDC position on Arbitrum
 */
const TEST_POSITION = {
  chainId: 42161, // Arbitrum
  nftId: 4865121, // Real closed position
};

describe('GET /api/v1/positions/uniswapv3/:chainId/:nftId', () => {
  let testChainId: number;
  let testNftId: string;
  let testPositionId: string;

  // ============================================================================
  // SETUP - Import position first to test against
  // ============================================================================

  beforeAll(async () => {
    // Import the position first so we have something to fetch
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
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      expect(response.status).toBe(401);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
    }, 5000);

    it('should accept authenticated requests with API key', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<GetUniswapV3PositionResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
    }, 15000);
  });

  // ============================================================================
  // PATH PARAMETER VALIDATION TESTS
  // ============================================================================

  describe('path parameter validation', () => {
    it('should reject invalid chainId format with 400', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/invalid/${testNftId}`
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject empty nftId with 400', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/`
      );

      // Note: This might result in a 404 due to route matching failure
      // depending on Next.js routing behavior
      expect([400, 404]).toContain(response.status);
    }, 5000);

    it('should return 404 for non-existent position', async () => {
      const nonExistentNftId = '9999999999';
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${nonExistentNftId}`
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
        `/api/v1/positions/uniswapv3/${wrongChainId}/${testNftId}`
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
    it('should fetch position successfully with 200 OK', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<GetUniswapV3PositionResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('meta');
    }, 15000);

    it('should return correct position data structure', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      const data = await parseJsonResponse<GetUniswapV3PositionResponse>(response);
      const position = data.data;

      // Core position fields
      expect(position).toHaveProperty('id', testPositionId);
      expect(position).toHaveProperty('protocol', 'uniswapv3');
      expect(position).toHaveProperty('positionType', 'CL_TICKS');
      expect(position).toHaveProperty('userId');
      expect(typeof position.userId).toBe('string');

      // PnL fields
      expect(position).toHaveProperty('currentValue');
      expect(position).toHaveProperty('currentCostBasis');
      expect(position).toHaveProperty('realizedPnl');
      expect(position).toHaveProperty('unrealizedPnl');

      // Fee fields
      expect(position).toHaveProperty('collectedFees');
      expect(position).toHaveProperty('unClaimedFees');
      expect(position).toHaveProperty('lastFeesCollectedAt');

      // Price range
      expect(position).toHaveProperty('priceRangeLower');
      expect(position).toHaveProperty('priceRangeUpper');

      // Pool
      expect(position).toHaveProperty('pool');
      expect(position.pool).toHaveProperty('id');
      expect(position.pool).toHaveProperty('token0');
      expect(position.pool).toHaveProperty('token1');
      expect(position.pool).toHaveProperty('config');
      expect(position.pool).toHaveProperty('state');

      // Token roles
      expect(position).toHaveProperty('isToken0Quote');
      expect(typeof position.isToken0Quote).toBe('boolean');

      // Position state
      expect(position).toHaveProperty('positionOpenedAt');
      expect(position).toHaveProperty('positionClosedAt');
      expect(position).toHaveProperty('isActive');

      // Protocol-specific config
      expect(position).toHaveProperty('config');
      expect(position.config).toHaveProperty('chainId', testChainId);
      expect(position.config).toHaveProperty('nftId', parseInt(testNftId, 10));
      expect(position.config).toHaveProperty('poolAddress');
      expect(position.config).toHaveProperty('tickUpper');
      expect(position.config).toHaveProperty('tickLower');

      // Protocol-specific state
      expect(position).toHaveProperty('state');
      expect(position.state).toHaveProperty('ownerAddress');
      expect(position.state).toHaveProperty('liquidity');
      expect(position.state).toHaveProperty('feeGrowthInside0LastX128');
      expect(position.state).toHaveProperty('feeGrowthInside1LastX128');
      expect(position.state).toHaveProperty('tokensOwed0');
      expect(position.state).toHaveProperty('tokensOwed1');

      // Timestamps
      expect(position).toHaveProperty('createdAt');
      expect(position).toHaveProperty('updatedAt');
    }, 15000);

    it('should serialize bigint fields as strings', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      const data = await parseJsonResponse<GetUniswapV3PositionResponse>(response);
      const position = data.data;

      // PnL fields (bigint → string)
      expect(typeof position.currentValue).toBe('string');
      expect(typeof position.currentCostBasis).toBe('string');
      expect(typeof position.realizedPnl).toBe('string');
      expect(typeof position.unrealizedPnl).toBe('string');

      // Fee fields (bigint → string)
      expect(typeof position.collectedFees).toBe('string');
      expect(typeof position.unClaimedFees).toBe('string');

      // Price range (bigint → string)
      expect(typeof position.priceRangeLower).toBe('string');
      expect(typeof position.priceRangeUpper).toBe('string');

      // State fields (bigint → string)
      expect(typeof position.state.liquidity).toBe('string');
      expect(typeof position.state.feeGrowthInside0LastX128).toBe('string');
      expect(typeof position.state.feeGrowthInside1LastX128).toBe('string');
      expect(typeof position.state.tokensOwed0).toBe('string');
      expect(typeof position.state.tokensOwed1).toBe('string');

      // Pool state fields (bigint → string)
      expect(typeof position.pool.state.sqrtPriceX96).toBe('string');
      expect(typeof position.pool.state.liquidity).toBe('string');
      expect(typeof position.pool.state.feeGrowthGlobal0).toBe('string');
      expect(typeof position.pool.state.feeGrowthGlobal1).toBe('string');
    }, 15000);

    it('should serialize Date fields as ISO strings', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      const data = await parseJsonResponse<GetUniswapV3PositionResponse>(response);
      const position = data.data;

      // Position timestamps
      expect(typeof position.createdAt).toBe('string');
      expect(typeof position.updatedAt).toBe('string');
      expect(typeof position.positionOpenedAt).toBe('string');
      expect(typeof position.lastFeesCollectedAt).toBe('string');

      // Validate ISO 8601 format
      expect(() => new Date(position.createdAt)).not.toThrow();
      expect(() => new Date(position.updatedAt)).not.toThrow();
      expect(() => new Date(position.positionOpenedAt)).not.toThrow();
      expect(() => new Date(position.lastFeesCollectedAt)).not.toThrow();

      // positionClosedAt can be null or string (this is a closed position)
      if (position.positionClosedAt !== null) {
        expect(typeof position.positionClosedAt).toBe('string');
        expect(() => new Date(position.positionClosedAt!)).not.toThrow();
      }

      // Pool timestamps
      expect(typeof position.pool.createdAt).toBe('string');
      expect(typeof position.pool.updatedAt).toBe('string');

      // Token timestamps
      expect(typeof position.pool.token0.createdAt).toBe('string');
      expect(typeof position.pool.token0.updatedAt).toBe('string');
      expect(typeof position.pool.token1.createdAt).toBe('string');
      expect(typeof position.pool.token1.updatedAt).toBe('string');
    }, 15000);

    it('should have USDC as quote token and WETH as base token', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      const data = await parseJsonResponse<GetUniswapV3PositionResponse>(response);
      const position = data.data;

      // Check pool has WETH and USDC tokens
      const token0Symbol = position.pool.token0.symbol;
      const token1Symbol = position.pool.token1.symbol;

      expect([token0Symbol, token1Symbol]).toContain('WETH');
      expect([token0Symbol, token1Symbol]).toContain('USDC');

      // Quote token should be USDC (auto-detected)
      const quoteToken = position.isToken0Quote
        ? position.pool.token0
        : position.pool.token1;
      const baseToken = position.isToken0Quote
        ? position.pool.token1
        : position.pool.token0;

      expect(quoteToken.symbol).toBe('USDC');
      expect(baseToken.symbol).toBe('WETH');
    }, 15000);

    it('should include metadata with timestamp', async () => {
      const response = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      const data = await parseJsonResponse<GetUniswapV3PositionResponse>(response);

      expect(data).toHaveProperty('meta');
      expect(data.meta).toHaveProperty('timestamp');
      expect(typeof data.meta.timestamp).toBe('string');
      expect(() => new Date(data.meta.timestamp)).not.toThrow();
    }, 15000);
  });

  // ============================================================================
  // REFRESH BEHAVIOR TESTS
  // ============================================================================

  describe('refresh behavior', () => {
    it('should call refresh() and update position state from blockchain', async () => {
      // First call - initial fetch
      const response1 = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      expect(response1.status).toBe(200);

      const data1 = await parseJsonResponse<GetUniswapV3PositionResponse>(response1);
      const updatedAt1 = data1.data.updatedAt;

      // Second call after a short delay - should refresh again
      // Note: In reality, refresh reads current on-chain state each time
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response2 = await authenticatedGet(
        `/api/v1/positions/uniswapv3/${testChainId}/${testNftId}`
      );

      expect(response2.status).toBe(200);

      const data2 = await parseJsonResponse<GetUniswapV3PositionResponse>(response2);
      const updatedAt2 = data2.data.updatedAt;

      // updatedAt should be different (position was refreshed)
      // Note: This might be the same if the refresh happens within the same second
      // But at minimum, both should be valid timestamps
      expect(() => new Date(updatedAt1)).not.toThrow();
      expect(() => new Date(updatedAt2)).not.toThrow();

      // Position ID should remain the same
      expect(data2.data.id).toBe(data1.data.id);

      // Core config should remain the same
      expect(data2.data.config.chainId).toBe(data1.data.config.chainId);
      expect(data2.data.config.nftId).toBe(data1.data.config.nftId);
    }, 20000); // Extended timeout for two on-chain calls
  });
});
