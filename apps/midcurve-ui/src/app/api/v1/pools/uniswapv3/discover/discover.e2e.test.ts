/**
 * Uniswap V3 Pool Discovery Endpoint E2E Tests
 *
 * Tests the GET /api/v1/pools/uniswapv3/discover endpoint end-to-end.
 *
 * Note: This endpoint makes real calls to:
 * - Uniswap V3 Factory contract on Arbitrum (on-chain)
 * - Uniswap V3 Subgraph for Arbitrum (The Graph)
 *
 * Tests use well-known pools on Arbitrum for reliability:
 * - WETH/USDC - High liquidity, multiple fee tiers
 * - WBTC/USDC - Medium liquidity
 * - WBTC/WETH - BTC/ETH pair
 */

import { describe, it, expect } from 'vitest';
import {
  authenticatedGet,
  unauthenticatedGet,
  parseJsonResponse,
  TEST_TOKENS,
} from '@/test/helpers';
import type { DiscoverUniswapV3PoolsResponse } from '@midcurve/api-shared';

const WETH = TEST_TOKENS.WETH_ARBITRUM;
const USDC = TEST_TOKENS.USDC_ARBITRUM;
const WBTC = TEST_TOKENS.WBTC_ARBITRUM;

describe('GET /api/v1/pools/uniswapv3/discover', () => {
  describe('successful pool discovery', () => {
    it(
      'should return 200 OK with valid token pair',
      async () => {
        const response = await authenticatedGet(
          `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=${WETH.address}&tokenB=${USDC.address}`
        );
        expect(response.status).toBe(200);
      },
      { timeout: 10000 }
    );

    it(
      'should return valid JSON response structure',
      async () => {
        const response = await authenticatedGet(
          `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=${WETH.address}&tokenB=${USDC.address}`
        );
        const data =
          await parseJsonResponse<DiscoverUniswapV3PoolsResponse>(response);

        expect(data).toBeDefined();
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
        expect(data.meta).toBeDefined();
        expect(data.meta?.count).toBeDefined();
        expect(data.meta?.chainId).toBe(WETH.chainId);
        expect(data.meta?.timestamp).toBeDefined();
      },
      { timeout: 10000 }
    );

    it(
      'should return pool discovery results with correct structure',
      async () => {
        const response = await authenticatedGet(
          `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=${WETH.address}&tokenB=${USDC.address}`
        );
        const data =
          await parseJsonResponse<DiscoverUniswapV3PoolsResponse>(response);

        // Should find at least one pool for WETH/USDC on Arbitrum
        expect(data.data.length).toBeGreaterThan(0);

        const pool = data.data[0]!;

        // Check discovery result structure
        expect(pool.poolName).toBeDefined();
        expect(typeof pool.poolName).toBe('string');
        expect(pool.fee).toBeDefined();
        expect(typeof pool.fee).toBe('number');
        expect(pool.protocol).toBe('uniswapv3');
        expect(pool.tvlUSD).toBeDefined();
        expect(typeof pool.tvlUSD).toBe('string');
        expect(pool.volumeUSD).toBeDefined();
        expect(typeof pool.volumeUSD).toBe('string');
        expect(pool.feesUSD).toBeDefined();
        expect(typeof pool.feesUSD).toBe('string');

        // Check nested pool structure
        expect(pool.pool).toBeDefined();
        expect(pool.pool.id).toBeDefined();
        expect(typeof pool.pool.id).toBe('string');
        expect(pool.pool.protocol).toBe('uniswapv3');
        expect(pool.pool.poolType).toBe('CL_TICKS');
        expect(pool.pool.token0).toBeDefined();
        expect(pool.pool.token1).toBeDefined();
        expect(pool.pool.feeBps).toBeDefined();
        expect(typeof pool.pool.feeBps).toBe('number');
        expect(pool.pool.config).toBeDefined();
        expect(pool.pool.state).toBeDefined();
        expect(pool.pool.createdAt).toBeDefined();
        expect(pool.pool.updatedAt).toBeDefined();
      },
      { timeout: 10000 }
    );

    it(
      'should serialize bigint fields as strings',
      async () => {
        const response = await authenticatedGet(
          `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=${WETH.address}&tokenB=${USDC.address}`
        );
        const data =
          await parseJsonResponse<DiscoverUniswapV3PoolsResponse>(response);

        const pool = data.data[0]!;

        // Pool state should have bigint fields serialized as strings
        expect(typeof pool.pool.state.sqrtPriceX96).toBe('string');
        expect(typeof pool.pool.state.liquidity).toBe('string');
        expect(typeof pool.pool.state.currentTick).toBe('number');
        expect(typeof pool.pool.state.feeGrowthGlobal0).toBe('string');
        expect(typeof pool.pool.state.feeGrowthGlobal1).toBe('string');

        // Verify they're valid numeric strings
        expect(BigInt(pool.pool.state.sqrtPriceX96)).toBeDefined();
        expect(BigInt(pool.pool.state.liquidity)).toBeDefined();
        expect(BigInt(pool.pool.state.feeGrowthGlobal0)).toBeDefined();
        expect(BigInt(pool.pool.state.feeGrowthGlobal1)).toBeDefined();
      },
      { timeout: 10000 }
    );

    it(
      'should sort results by TVL descending',
      async () => {
        const response = await authenticatedGet(
          `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=${WETH.address}&tokenB=${USDC.address}`
        );
        const data =
          await parseJsonResponse<DiscoverUniswapV3PoolsResponse>(response);

        // If multiple pools found, verify they're sorted by TVL descending
        if (data.data.length > 1) {
          for (let i = 0; i < data.data.length - 1; i++) {
            const currentTVL = parseFloat(data.data[i]!.tvlUSD);
            const nextTVL = parseFloat(data.data[i + 1]!.tvlUSD);
            expect(currentTVL).toBeGreaterThanOrEqual(nextTVL);
          }
        }
      },
      { timeout: 10000 }
    );

    it(
      'should work with WBTC/USDC pair',
      async () => {
        const response = await authenticatedGet(
          `/api/v1/pools/uniswapv3/discover?chainId=${WBTC.chainId}&tokenA=${WBTC.address}&tokenB=${USDC.address}`
        );
        const data =
          await parseJsonResponse<DiscoverUniswapV3PoolsResponse>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
        // May or may not have pools, but should succeed without errors
      },
      { timeout: 10000 }
    );

    it(
      'should work with WBTC/WETH pair',
      async () => {
        const response = await authenticatedGet(
          `/api/v1/pools/uniswapv3/discover?chainId=${WBTC.chainId}&tokenA=${WBTC.address}&tokenB=${WETH.address}`
        );
        const data =
          await parseJsonResponse<DiscoverUniswapV3PoolsResponse>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
      },
      { timeout: 10000 }
    );
  });

  describe('validation errors', () => {
    it('should return 400 for missing chainId', async () => {
      const response = await authenticatedGet(
        `/api/v1/pools/uniswapv3/discover?tokenA=${WETH.address}&tokenB=${USDC.address}`
      );
      const data = await parseJsonResponse<{ success: false; error: { code: string } }>(response);

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing tokenA', async () => {
      const response = await authenticatedGet(
        `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenB=${USDC.address}`
      );
      const data = await parseJsonResponse<{ success: false; error: { code: string } }>(response);

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing tokenB', async () => {
      const response = await authenticatedGet(
        `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=${WETH.address}`
      );
      const data = await parseJsonResponse<{ success: false; error: { code: string } }>(response);

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid address format (tokenA)', async () => {
      const response = await authenticatedGet(
        `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=invalid&tokenB=${USDC.address}`
      );
      const data = await parseJsonResponse<{ success: false; error: { code: string } }>(response);

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid chainId format', async () => {
      const response = await authenticatedGet(
        `/api/v1/pools/uniswapv3/discover?chainId=abc&tokenA=${WETH.address}&tokenB=${USDC.address}`
      );
      const data = await parseJsonResponse<{ success: false; error: { code: string } }>(response);

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('authentication', () => {
    it('should return 401 without authentication', async () => {
      const response = await unauthenticatedGet(
        `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=${WETH.address}&tokenB=${USDC.address}`
      );

      expect(response.status).toBe(401);
    });
  });

  describe('edge cases', () => {
    it(
      'should handle lowercase addresses',
      async () => {
        const response = await authenticatedGet(
          `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=${WETH.address.toLowerCase()}&tokenB=${USDC.address.toLowerCase()}`
        );
        const data =
          await parseJsonResponse<DiscoverUniswapV3PoolsResponse>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
      },
      { timeout: 10000 }
    );

    it(
      'should handle reversed token order',
      async () => {
        // Try tokenB/tokenA instead of tokenA/tokenB
        const response = await authenticatedGet(
          `/api/v1/pools/uniswapv3/discover?chainId=${WETH.chainId}&tokenA=${USDC.address}&tokenB=${WETH.address}`
        );
        const data =
          await parseJsonResponse<DiscoverUniswapV3PoolsResponse>(response);

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
        // Should find same pools regardless of token order
        // (service internally sorts addresses to canonical order)
      },
      { timeout: 10000 }
    );
  });
});
