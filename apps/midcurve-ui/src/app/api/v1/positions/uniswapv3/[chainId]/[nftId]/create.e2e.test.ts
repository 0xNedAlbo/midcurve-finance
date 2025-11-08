/**
 * Position Create Endpoint E2E Tests
 *
 * Tests the PUT /api/v1/positions/uniswapv3/:chainId/:nftId endpoint end-to-end.
 *
 * Note: This endpoint makes minimal on-chain calls:
 * - Pool discovery (if not cached)
 * - Historic pool price at event blockNumber
 *
 * Test uses mock data for a hypothetical USDC/WETH position on Arbitrum.
 */

import { describe, it, expect } from 'vitest';
import {
  authenticatedPut,
  unauthenticatedPut,
  parseJsonResponse,
} from '@/test/helpers';
import type { CreateUniswapV3PositionResponse } from '@midcurve/api-shared';

/**
 * Test position: USDC/WETH position on Arbitrum
 *
 * Pool: 0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443 (USDC/WETH 0.05% on Arbitrum)
 * This is a real pool that exists on Arbitrum
 */
const TEST_CHAIN_ID = 42161; // Arbitrum
const TEST_NFT_ID = 999999; // Hypothetical NFT ID (won't conflict with real positions)

const VALID_CREATE_REQUEST = {
  poolAddress: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443', // Real USDC/WETH pool on Arbitrum
  tickUpper: 201120,
  tickLower: 199120,
  ownerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0', // Test wallet address
  quoteTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
  increaseEvent: {
    timestamp: '2024-01-15T10:30:00Z',
    blockNumber: '175000000',
    transactionIndex: 42,
    logIndex: 5,
    transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    liquidity: '1000000000000000000',
    amount0: '500000000', // 500 USDC (6 decimals)
    amount1: '250000000000000000', // 0.25 WETH (18 decimals)
  },
};

describe('PUT /api/v1/positions/uniswapv3/:chainId/:nftId', () => {
  // ============================================================================
  // AUTHENTICATION TESTS
  // ============================================================================

  describe('authentication', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await unauthenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        VALID_CREATE_REQUEST
      );

      expect(response.status).toBe(401);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
    }, 5000);
  });

  // ============================================================================
  // VALIDATION TESTS - PATH PARAMETERS
  // ============================================================================

  describe('path parameter validation', () => {
    it('should reject invalid chainId with 400', async () => {
      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/invalid/${TEST_NFT_ID}`,
        VALID_CREATE_REQUEST
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject invalid nftId with 400', async () => {
      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/invalid`,
        VALID_CREATE_REQUEST
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject negative chainId with 400', async () => {
      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/-1/${TEST_NFT_ID}`,
        VALID_CREATE_REQUEST
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);
  });

  // ============================================================================
  // VALIDATION TESTS - REQUEST BODY
  // ============================================================================

  describe('request body validation', () => {
    it('should reject missing poolAddress with 400', async () => {
      const invalidRequest = { ...VALID_CREATE_REQUEST };
      delete (invalidRequest as any).poolAddress;

      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        invalidRequest
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject invalid poolAddress format with 400', async () => {
      const invalidRequest = {
        ...VALID_CREATE_REQUEST,
        poolAddress: 'not-a-valid-address',
      };

      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        invalidRequest
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject missing ownerAddress with 400', async () => {
      const invalidRequest = { ...VALID_CREATE_REQUEST };
      delete (invalidRequest as any).ownerAddress;

      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        invalidRequest
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject missing increaseEvent with 400', async () => {
      const invalidRequest = { ...VALID_CREATE_REQUEST };
      delete (invalidRequest as any).increaseEvent;

      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        invalidRequest
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject invalid increaseEvent.timestamp format with 400', async () => {
      const invalidRequest = {
        ...VALID_CREATE_REQUEST,
        increaseEvent: {
          ...VALID_CREATE_REQUEST.increaseEvent,
          timestamp: 'not-a-valid-timestamp',
        },
      };

      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        invalidRequest
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject invalid increaseEvent.blockNumber format with 400', async () => {
      const invalidRequest = {
        ...VALID_CREATE_REQUEST,
        increaseEvent: {
          ...VALID_CREATE_REQUEST.increaseEvent,
          blockNumber: 'not-a-number',
        },
      };

      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        invalidRequest
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject invalid increaseEvent.liquidity format with 400', async () => {
      const invalidRequest = {
        ...VALID_CREATE_REQUEST,
        increaseEvent: {
          ...VALID_CREATE_REQUEST.increaseEvent,
          liquidity: 'not-a-number',
        },
      };

      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        invalidRequest
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);
  });

  // ============================================================================
  // SUCCESSFUL CREATE TESTS
  // ============================================================================

  describe('successful position creation', () => {
    it('should create position successfully with 200 OK', async () => {
      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        VALID_CREATE_REQUEST
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<CreateUniswapV3PositionResponse>(response);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('meta');
    }, 30000); // Longer timeout for on-chain calls

    it('should return correct position data structure', async () => {
      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        VALID_CREATE_REQUEST
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<CreateUniswapV3PositionResponse>(response);

      // Response structure
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();

      // Position fields
      expect(data.data.id).toBeDefined();
      expect(data.data.protocol).toBe('uniswapv3');
      expect(data.data.positionType).toBe('CL_TICKS');
      expect(data.data.isToken0Quote).toBeDefined();

      // Config
      expect(data.data.config).toBeDefined();
      expect(data.data.config.chainId).toBe(TEST_CHAIN_ID);
      expect(data.data.config.nftId).toBe(TEST_NFT_ID);
      expect(data.data.config.tickUpper).toBe(VALID_CREATE_REQUEST.tickUpper);
      expect(data.data.config.tickLower).toBe(VALID_CREATE_REQUEST.tickLower);

      // State
      expect(data.data.state).toBeDefined();
      expect(data.data.state.liquidity).toBe(VALID_CREATE_REQUEST.increaseEvent.liquidity);
      expect(data.data.state.ownerAddress).toBeDefined();

      // Pool
      expect(data.data.pool).toBeDefined();
      expect(data.data.pool.token0).toBeDefined();
      expect(data.data.pool.token1).toBeDefined();

      // Financial fields (should be set after ledger event)
      expect(data.data.currentValue).toBeDefined();
      expect(data.data.currentCostBasis).toBeDefined();
      expect(data.data.unrealizedPnl).toBeDefined();
    }, 30000);

    it('should be idempotent - return existing position on second call', async () => {
      // First call - creates position
      const response1 = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        VALID_CREATE_REQUEST
      );

      expect(response1.status).toBe(200);
      const data1 = await parseJsonResponse<CreateUniswapV3PositionResponse>(response1);
      const positionId1 = data1.data.id;

      // Second call - should return existing position
      const response2 = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        VALID_CREATE_REQUEST
      );

      expect(response2.status).toBe(200);
      const data2 = await parseJsonResponse<CreateUniswapV3PositionResponse>(response2);
      const positionId2 = data2.data.id;

      // Should return same position ID
      expect(positionId2).toBe(positionId1);
    }, 30000);

    it('should accept request without quoteTokenAddress (auto-detect)', async () => {
      const requestWithoutQuote = { ...VALID_CREATE_REQUEST };
      delete (requestWithoutQuote as any).quoteTokenAddress;

      // Use different NFT ID to avoid conflict
      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID + 1}`,
        requestWithoutQuote
      );

      expect(response.status).toBe(200);

      const data = await parseJsonResponse<CreateUniswapV3PositionResponse>(response);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.isToken0Quote).toBeDefined(); // Should have auto-detected
    }, 30000);
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('error handling', () => {
    it('should handle pool not found with 404', async () => {
      const invalidRequest = {
        ...VALID_CREATE_REQUEST,
        poolAddress: '0x0000000000000000000000000000000000000001', // Non-existent pool
      };

      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID + 10}`,
        invalidRequest
      );

      // May return 404 or 400 depending on how pool discovery fails
      expect([400, 404]).toContain(response.status);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
    }, 30000);

    it('should handle unsupported chain with 400', async () => {
      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/99999/${TEST_NFT_ID + 20}`, // Invalid chain ID
        VALID_CREATE_REQUEST
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'CHAIN_NOT_SUPPORTED');
    }, 5000);
  });
});
