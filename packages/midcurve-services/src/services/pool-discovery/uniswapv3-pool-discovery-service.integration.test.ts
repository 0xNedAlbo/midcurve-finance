/**
 * Integration Tests for UniswapV3PoolDiscoveryService
 *
 * Tests against real Uniswap V3 contracts on mainnet.
 * Requires RPC_URL_ETHEREUM and THE_GRAPH_API_KEY environment variables.
 *
 * Run with:
 * npm run test:integration -- uniswapv3-pool-discovery-service.integration.test.ts
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { UniswapV3PoolDiscoveryService } from './uniswapv3-pool-discovery-service.js';
import {
  WETH_USDC_INPUT,
  WETH_DAI_INPUT,
  KNOWN_TOKEN_PAIRS,
} from './test-fixtures.js';

describe('UniswapV3PoolDiscoveryService Integration Tests', () => {
  let service: UniswapV3PoolDiscoveryService;

  beforeAll(() => {
    // Check for required environment variables
    if (!process.env.RPC_URL_ETHEREUM) {
      throw new Error(
        'RPC_URL_ETHEREUM environment variable is required for integration tests'
      );
    }

    // THE_GRAPH_API_KEY is checked by subgraph client, but we provide a helpful message
    if (!process.env.THE_GRAPH_API_KEY) {
      console.warn(
        'Warning: THE_GRAPH_API_KEY not set. Subgraph queries may fail or use rate-limited endpoints.'
      );
    }

    service = new UniswapV3PoolDiscoveryService();
  });

  // ==========================================================================
  // Real Pool Discovery Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - Real Pools', () => {
    it(
      'should discover WETH/USDC pools on Ethereum',
      async () => {
        const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

        // Should find at least 2 pools (0.05% and 0.3% are known to exist)
        expect(results.length).toBeGreaterThanOrEqual(2);

        // All results should have the uniswapv3 protocol
        results.forEach((result) => {
          expect(result.protocol).toBe('uniswapv3');
        });

        // All results should have pool names
        results.forEach((result) => {
          expect(result.poolName).toMatch(/^CL\d+-\w+\/\w+$/);
        });

        // Results should be sorted by TVL descending (if metrics available)
        for (let i = 0; i < results.length - 1; i++) {
          const currentTVL = parseFloat(results[i]!.tvlUSD);
          const nextTVL = parseFloat(results[i + 1]!.tvlUSD);
          expect(currentTVL).toBeGreaterThanOrEqual(nextTVL);
        }

        // Check that specific known pools exist
        const pool500 = results.find((r) => r.fee === 500);
        const pool3000 = results.find((r) => r.fee === 3000);

        expect(pool500).toBeDefined();
        expect(pool3000).toBeDefined();

        // Verify pool addresses match known deployments
        const { expectedPools } = KNOWN_TOKEN_PAIRS.WETH_USDC_ETHEREUM;
        const expected500 = expectedPools.find((p) => p.fee === 500);
        const expected3000 = expectedPools.find((p) => p.fee === 3000);

        expect(pool500!.pool.config.address.toLowerCase()).toBe(
          expected500!.poolAddress.toLowerCase()
        );
        expect(pool3000!.pool.config.address.toLowerCase()).toBe(
          expected3000!.poolAddress.toLowerCase()
        );

        // Verify token symbols
        results.forEach((result) => {
          const symbols = [
            result.pool.token0.symbol,
            result.pool.token1.symbol,
          ].sort();
          expect(symbols).toEqual(['USDC', 'WETH']);
        });
      },
      { timeout: 30000 }
    ); // 30s timeout for RPC calls

    it(
      'should discover WETH/DAI pools on Ethereum',
      async () => {
        const results = await service.findPoolsForTokenPair(WETH_DAI_INPUT);

        // Should find at least 1 pool
        expect(results.length).toBeGreaterThanOrEqual(1);

        // All results should have the uniswapv3 protocol
        results.forEach((result) => {
          expect(result.protocol).toBe('uniswapv3');
        });

        // Verify token symbols
        results.forEach((result) => {
          const symbols = [
            result.pool.token0.symbol,
            result.pool.token1.symbol,
          ].sort();
          expect(symbols).toEqual(['DAI', 'WETH']);
        });
      },
      { timeout: 30000 }
    );

    it(
      'should return empty array for non-existent pool pair',
      async () => {
        // Use two random addresses that definitely don't have pools
        const results = await service.findPoolsForTokenPair({
          chainId: 1,
          tokenA: '0x0000000000000000000000000000000000000001',
          tokenB: '0x0000000000000000000000000000000000000002',
        });

        expect(results).toHaveLength(0);
      },
      { timeout: 30000 }
    );
  });

  // ==========================================================================
  // Pool Metrics Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - Metrics Enrichment', () => {
    it(
      'should enrich pools with subgraph metrics',
      async () => {
        const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

        expect(results.length).toBeGreaterThan(0);

        // Check that at least one pool has non-zero metrics
        // (Some pools might have zero metrics if they're very new)
        const hasNonZeroMetrics = results.some(
          (result) =>
            parseFloat(result.tvlUSD) > 0 ||
            parseFloat(result.volumeUSD) > 0 ||
            parseFloat(result.feesUSD) > 0
        );

        expect(hasNonZeroMetrics).toBe(true);

        // All results should have metrics (even if "0")
        results.forEach((result) => {
          expect(result.tvlUSD).toBeDefined();
          expect(result.volumeUSD).toBeDefined();
          expect(result.feesUSD).toBeDefined();

          // Metrics should be valid numeric strings
          expect(() => parseFloat(result.tvlUSD)).not.toThrow();
          expect(() => parseFloat(result.volumeUSD)).not.toThrow();
          expect(() => parseFloat(result.feesUSD)).not.toThrow();
        });
      },
      { timeout: 30000 }
    );
  });

  // ==========================================================================
  // Address Handling Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - Address Handling', () => {
    it(
      'should handle lowercase addresses',
      async () => {
        const results = await service.findPoolsForTokenPair({
          chainId: 1,
          tokenA: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH (lowercase)
          tokenB: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC (lowercase)
        });

        expect(results.length).toBeGreaterThanOrEqual(2);

        // Verify that addresses were normalized
        results.forEach((result) => {
          // Pool addresses should be in checksum format
          expect(result.pool.config.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
          expect(result.pool.token0.config.address).toMatch(
            /^0x[a-fA-F0-9]{40}$/
          );
          expect(result.pool.token1.config.address).toMatch(
            /^0x[a-fA-F0-9]{40}$/
          );
        });
      },
      { timeout: 30000 }
    );

    it(
      'should handle reversed token order',
      async () => {
        // Provide USDC first, WETH second (reversed from canonical order)
        const results = await service.findPoolsForTokenPair({
          chainId: 1,
          tokenA: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC (higher address)
          tokenB: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH (lower address)
        });

        expect(results.length).toBeGreaterThanOrEqual(2);

        // Verify that token0 < token1 (canonical order)
        results.forEach((result) => {
          // String comparison: token0 should be lexicographically less than token1
          const token0Lower = result.pool.token0.config.address.toLowerCase();
          const token1Lower = result.pool.token1.config.address.toLowerCase();
          expect(token0Lower < token1Lower).toBe(true);
        });
      },
      { timeout: 30000 }
    );
  });

  // ==========================================================================
  // Pool Name Format Tests
  // ==========================================================================

  describe('findPoolsForTokenPair - Pool Names', () => {
    it(
      'should generate correct pool names',
      async () => {
        const results = await service.findPoolsForTokenPair(WETH_USDC_INPUT);

        expect(results.length).toBeGreaterThan(0);

        // Check pool name format
        results.forEach((result) => {
          // Should match format: CL{tickSpacing}-{token0}/{token1}
          expect(result.poolName).toMatch(/^CL\d+-[A-Z0-9]+\/[A-Z0-9]+$/);

          // Pool name should include actual tick spacing from config
          const tickSpacing = result.pool.config.tickSpacing;
          expect(result.poolName).toContain(`CL${tickSpacing}`);

          // Pool name should include token symbols
          expect(result.poolName).toContain(result.pool.token0.symbol);
          expect(result.poolName).toContain(result.pool.token1.symbol);
        });

        // Check specific pool names for known fee tiers
        const pool500 = results.find((r) => r.fee === 500);
        const pool3000 = results.find((r) => r.fee === 3000);

        if (pool500) {
          expect(pool500.poolName).toBe('CL10-USDC/WETH');
        }

        if (pool3000) {
          expect(pool3000.poolName).toBe('CL60-USDC/WETH');
        }
      },
      { timeout: 30000 }
    );
  });
});
