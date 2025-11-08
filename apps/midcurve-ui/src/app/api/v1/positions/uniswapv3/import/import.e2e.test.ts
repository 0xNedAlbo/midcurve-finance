/**
 * Position Import Endpoint E2E Tests
 *
 * Tests the POST /api/v1/positions/uniswapv3/import endpoint end-to-end.
 *
 * Note: This endpoint makes real calls to:
 * - Uniswap V3 NonfungiblePositionManager contract on Arbitrum (on-chain)
 * - Uniswap V3 pool contracts for state data (on-chain)
 * - Token contracts for metadata (on-chain)
 *
 * Test uses a well-known closed position on Arbitrum for reliability:
 * - NFT ID: 4865121
 * - Pool: WETH/USDC (0.05% fee tier)
 * - Status: Closed position
 * - Quote token: USDC (auto-detected via QuoteTokenService)
 * - Base token: WETH
 */

import { describe, it, expect } from 'vitest';
import {
  authenticatedPost,
  unauthenticatedPost,
  parseJsonResponse,
} from '@/test/helpers';
import type { ImportUniswapV3PositionResponse } from '@midcurve/api-shared';

/**
 * Test position: Closed WETH/USDC position on Arbitrum
 */
const TEST_POSITION = {
  chainId: 42161, // Arbitrum
  nftId: 4865121, // Real closed position
};

describe('POST /api/v1/positions/uniswapv3/import', () => {
  // ============================================================================
  // AUTHENTICATION TESTS
  // ============================================================================

  describe('authentication', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await unauthenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        TEST_POSITION
      );

      expect(response.status).toBe(401);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
    }, 5000);

    it('should accept authenticated requests with API key', async () => {
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        TEST_POSITION
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<ImportUniswapV3PositionResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
    }, 15000);
  });

  // ============================================================================
  // VALIDATION TESTS
  // ============================================================================

  describe('validation', () => {
    it('should reject missing chainId with 400', async () => {
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        { nftId: TEST_POSITION.nftId }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject missing nftId with 400', async () => {
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        { chainId: TEST_POSITION.chainId }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject invalid chainId with 400', async () => {
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        { chainId: -1, nftId: TEST_POSITION.nftId }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject invalid nftId with 400', async () => {
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        { chainId: TEST_POSITION.chainId, nftId: -1 }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);
  });

  // ============================================================================
  // SUCCESSFUL IMPORT TESTS
  // ============================================================================

  describe('successful import', () => {
    it('should import position successfully with 200 OK', async () => {
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        TEST_POSITION
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<ImportUniswapV3PositionResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('meta');
    }, 15000);

    it('should return correct position data structure', async () => {
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        TEST_POSITION
      );

      const data = await parseJsonResponse<ImportUniswapV3PositionResponse>(response);
      const position = data.data;

      // Core position fields
      expect(position).toHaveProperty('id');
      expect(typeof position.id).toBe('string');
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

      // Protocol-specific
      expect(position).toHaveProperty('config');
      expect(position.config).toHaveProperty('chainId', TEST_POSITION.chainId);
      expect(position.config).toHaveProperty('nftId', TEST_POSITION.nftId);
      expect(position.config).toHaveProperty('poolAddress');
      expect(position.config).toHaveProperty('tickUpper');
      expect(position.config).toHaveProperty('tickLower');

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

    it('should have USDC as quote token and WETH as base token', async () => {
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        TEST_POSITION
      );

      const data = await parseJsonResponse<ImportUniswapV3PositionResponse>(response);
      const position = data.data;

      // Check pool has WETH and USDC tokens
      const token0Symbol = position.pool.token0.symbol;
      const token1Symbol = position.pool.token1.symbol;

      expect([token0Symbol, token1Symbol]).toContain('WETH');
      expect([token0Symbol, token1Symbol]).toContain('USDC');

      // Quote token service should auto-detect USDC as quote
      // (USDC is in default quote tokens list for Arbitrum)
      const quoteToken = position.isToken0Quote
        ? position.pool.token0
        : position.pool.token1;
      const baseToken = position.isToken0Quote
        ? position.pool.token1
        : position.pool.token0;

      expect(quoteToken.symbol).toBe('USDC');
      expect(baseToken.symbol).toBe('WETH');
    }, 15000);

    it('should serialize bigint fields as strings', async () => {
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        TEST_POSITION
      );

      const data = await parseJsonResponse<ImportUniswapV3PositionResponse>(response);
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
      const response = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        TEST_POSITION
      );

      const data = await parseJsonResponse<ImportUniswapV3PositionResponse>(response);
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

      // positionClosedAt can be null or string
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
  });

  // ============================================================================
  // IDEMPOTENCY TESTS
  // ============================================================================

  describe('idempotency', () => {
    it('should return existing position on duplicate import', async () => {
      // First import
      const response1 = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        TEST_POSITION
      );

      expect(response1.status).toBe(200);

      const data1 = await parseJsonResponse<ImportUniswapV3PositionResponse>(response1);
      const position1Id = data1.data.id;

      // Second import (duplicate)
      const response2 = await authenticatedPost(
        '/api/v1/positions/uniswapv3/import',
        TEST_POSITION
      );

      expect(response2.status).toBe(200);

      const data2 = await parseJsonResponse<ImportUniswapV3PositionResponse>(response2);
      const position2Id = data2.data.id;

      // Should return same position ID
      expect(position2Id).toBe(position1Id);

      // Should have same data (except possibly updatedAt)
      expect(data2.data.protocol).toBe(data1.data.protocol);
      expect(data2.data.config.chainId).toBe(data1.data.config.chainId);
      expect(data2.data.config.nftId).toBe(data1.data.config.nftId);
      expect(data2.data.userId).toBe(data1.data.userId);
    }, 20000);
  });
});
