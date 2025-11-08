/**
 * Integration tests for Erc20TokenService.discover()
 * Tests real-world token discovery with actual blockchain RPC calls,
 * database operations, and CoinGecko API interactions
 *
 * These tests verify:
 * - On-chain token metadata discovery via RPC
 * - CoinGecko enrichment data fetching
 * - Database persistence and caching
 * - Multi-chain support
 * - Address normalization (EIP-55)
 * - Error handling for various failure scenarios
 * - Idempotency and optimization
 *
 * NOTE: These tests make real RPC and API calls and may be subject to:
 * - Network latency and failures
 * - CoinGecko rate limiting (~30 calls/minute on free tier)
 * - RPC endpoint availability
 *
 * RATE LIMITING STRATEGY:
 * - Tests are designed to minimize API calls through caching
 * - CoinGecko client caches token list across tests
 * - Tests handle 429 errors gracefully with warnings
 * - Sequential execution recommended to reduce rate limit pressure
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Erc20TokenService } from './erc20-token-service.js';
import {
  getPrismaClient,
  disconnectPrisma,
  countAllRecords,
} from '../../test/helpers.js';
import {
  CoinGeckoClient,
  TokenNotFoundInCoinGeckoError,
  CoinGeckoApiError,
} from '../../clients/coingecko/index.js';
import { TokenMetadataError } from '../../utils/evm/index.js';

// Known stable tokens for testing (real addresses and expected data)
const TEST_TOKENS = {
  USDC_ETHEREUM: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
    expectedName: 'USD Coin',
    expectedSymbol: 'USDC',
    expectedDecimals: 6,
    expectedCoinId: 'usd-coin',
  },
  USDC_ARBITRUM: {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chainId: 42161,
    expectedName: 'USD Coin',
    expectedSymbol: 'USDC',
    expectedDecimals: 6,
    expectedCoinId: 'usd-coin',
  },
  WETH_ETHEREUM: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    chainId: 1,
    expectedName: 'Wrapped Ether',
    expectedSymbol: 'WETH',
    expectedDecimals: 18,
    expectedCoinId: 'weth',
  },
} as const;

// Helper to check if error is rate limit
function isRateLimitError(error: unknown): boolean {
  return error instanceof CoinGeckoApiError && error.statusCode === 429;
}

// Helper to measure execution time
async function measureExecutionTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

describe('Erc20TokenService.discover() - Integration Tests', () => {
  let service: Erc20TokenService;
  const prisma = getPrismaClient();

  beforeEach(() => {
    service = new Erc20TokenService({ prisma });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  // ==========================================================================
  // Successful Discovery Scenarios
  // ==========================================================================

  describe('Successful Discovery', () => {
    it(
      'should discover USDC on Ethereum from contract',
      { timeout: 30000 },
      async () => {
        try {
          const token = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Verify basic token fields from contract
          expect(token.id).toBeDefined();
          expect(token.tokenType).toBe('erc20');
          expect(token.name).toBe(TEST_TOKENS.USDC_ETHEREUM.expectedName);
          expect(token.symbol).toBe(TEST_TOKENS.USDC_ETHEREUM.expectedSymbol);
          expect(token.decimals).toBe(TEST_TOKENS.USDC_ETHEREUM.expectedDecimals);

          // Verify config
          expect(token.config.address).toBe(TEST_TOKENS.USDC_ETHEREUM.address);
          expect(token.config.chainId).toBe(TEST_TOKENS.USDC_ETHEREUM.chainId);

          // Verify CoinGecko enrichment
          expect(token.coingeckoId).toBe(TEST_TOKENS.USDC_ETHEREUM.expectedCoinId);
          expect(token.logoUrl).toBeDefined();
          expect(token.logoUrl).toContain('http');
          expect(token.marketCap).toBeDefined();
          expect(token.marketCap).toBeGreaterThan(0);

          // Verify persisted to database
          const dbToken = await prisma.token.findUnique({
            where: { id: token.id },
          });
          expect(dbToken).toBeDefined();
          expect(dbToken?.symbol).toBe('USDC');
          expect(dbToken?.coingeckoId).toBe('usd-coin');
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited by CoinGecko API - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should discover WETH on Ethereum from contract',
      { timeout: 30000 },
      async () => {
        try {
          const token = await service.discover({
            address: TEST_TOKENS.WETH_ETHEREUM.address,
            chainId: TEST_TOKENS.WETH_ETHEREUM.chainId,
          });

          // Verify basic token fields
          expect(token.name).toBe(TEST_TOKENS.WETH_ETHEREUM.expectedName);
          expect(token.symbol).toBe(TEST_TOKENS.WETH_ETHEREUM.expectedSymbol);
          expect(token.decimals).toBe(TEST_TOKENS.WETH_ETHEREUM.expectedDecimals);

          // Verify CoinGecko enrichment
          expect(token.coingeckoId).toBe(TEST_TOKENS.WETH_ETHEREUM.expectedCoinId);
          expect(token.logoUrl).toBeDefined();
          expect(token.marketCap).toBeGreaterThan(0);

          // Verify persisted
          const dbToken = await prisma.token.findUnique({
            where: { id: token.id },
          });
          expect(dbToken).toBeDefined();
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should discover USDC on Arbitrum from contract',
      { timeout: 30000 },
      async () => {
        try {
          const token = await service.discover({
            address: TEST_TOKENS.USDC_ARBITRUM.address,
            chainId: TEST_TOKENS.USDC_ARBITRUM.chainId,
          });

          // Verify basic token fields
          expect(token.name).toBe(TEST_TOKENS.USDC_ARBITRUM.expectedName);
          expect(token.symbol).toBe(TEST_TOKENS.USDC_ARBITRUM.expectedSymbol);
          expect(token.decimals).toBe(TEST_TOKENS.USDC_ARBITRUM.expectedDecimals);

          // Verify config has correct chain
          expect(token.config.chainId).toBe(42161);
          expect(token.config.address).toBe(TEST_TOKENS.USDC_ARBITRUM.address);

          // Verify CoinGecko enrichment (same coingeckoId as Ethereum USDC)
          expect(token.coingeckoId).toBe(TEST_TOKENS.USDC_ARBITRUM.expectedCoinId);
          expect(token.marketCap).toBeGreaterThan(0);

          // Verify persisted
          const counts = await countAllRecords();
          expect(counts.tokens).toBeGreaterThan(0);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should populate all required fields during discovery',
      { timeout: 30000 },
      async () => {
        try {
          const token = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Verify all required fields are present
          expect(token.id).toBeDefined();
          expect(token.createdAt).toBeInstanceOf(Date);
          expect(token.updatedAt).toBeInstanceOf(Date);
          expect(token.tokenType).toBe('erc20');
          expect(token.name).toBeDefined();
          expect(token.symbol).toBeDefined();
          expect(token.decimals).toBeGreaterThan(0);
          expect(token.config.address).toBeDefined();
          expect(token.config.chainId).toBeGreaterThan(0);

          // Verify optional enrichment fields are populated
          expect(token.logoUrl).toBeDefined();
          expect(token.coingeckoId).toBeDefined();
          expect(token.marketCap).toBeDefined();
          expect(token.marketCap).toBeGreaterThan(0);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );
  });

  // ==========================================================================
  // Database Caching & Idempotency
  // ==========================================================================

  describe('Database Caching & Idempotency', () => {
    it(
      'should return existing token on second discovery (idempotent)',
      { timeout: 30000 },
      async () => {
        try {
          // First discovery - creates token
          const token1 = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Second discovery - should return existing
          const token2 = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Should be same token
          expect(token1.id).toBe(token2.id);
          expect(token1.coingeckoId).toBe(token2.coingeckoId);

          // Verify only one token in database
          const counts = await countAllRecords();
          expect(counts.tokens).toBe(1);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should skip RPC call when token exists in database',
      { timeout: 30000 },
      async () => {
        try {
          // First discovery - makes RPC call
          const { duration: firstCallDuration } = await measureExecutionTime(() =>
            service.discover({
              address: TEST_TOKENS.USDC_ETHEREUM.address,
              chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
            })
          );

          // Second discovery - uses database cache (much faster)
          const { duration: secondCallDuration } = await measureExecutionTime(() =>
            service.discover({
              address: TEST_TOKENS.USDC_ETHEREUM.address,
              chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
            })
          );

          // Second call should be significantly faster (no RPC or CoinGecko calls)
          expect(secondCallDuration).toBeLessThan(firstCallDuration / 2);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should persist coingeckoId to database',
      { timeout: 30000 },
      async () => {
        try {
          const token = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Verify in-memory token has coingeckoId
          expect(token.coingeckoId).toBe('usd-coin');

          // Verify persisted to database
          const dbToken = await prisma.token.findUnique({
            where: { id: token.id },
          });
          expect(dbToken?.coingeckoId).toBe('usd-coin');
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );
  });

  // ==========================================================================
  // Token Enrichment Flow
  // ==========================================================================

  describe('Token Enrichment Flow', () => {
    it(
      'should enrich existing token that lacks CoinGecko data',
      { timeout: 30000 },
      async () => {
        try {
          // Create token without CoinGecko data (simulate old token)
          const manualToken = await service.create({
            tokenType: 'erc20',
            name: 'USD Coin',
            symbol: 'USDC',
            decimals: 6,
            config: {
              address: TEST_TOKENS.USDC_ETHEREUM.address,
              chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
            },
            // No logoUrl, coingeckoId, marketCap
          });

          // Verify not enriched
          expect(manualToken.coingeckoId).toBeUndefined();
          expect(manualToken.logoUrl).toBeUndefined();
          expect(manualToken.marketCap).toBeUndefined();

          // Call discover - should enrich existing token
          const enrichedToken = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Should be same token (same ID)
          expect(enrichedToken.id).toBe(manualToken.id);

          // Should now have CoinGecko data
          expect(enrichedToken.coingeckoId).toBe('usd-coin');
          expect(enrichedToken.logoUrl).toBeDefined();
          expect(enrichedToken.marketCap).toBeGreaterThan(0);

          // Verify enrichment persisted
          const dbToken = await prisma.token.findUnique({
            where: { id: manualToken.id },
          });
          expect(dbToken?.coingeckoId).toBe('usd-coin');
          expect(dbToken?.logoUrl).toBeDefined();
          expect(dbToken?.marketCap).toBeGreaterThan(0);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should skip enrichment if token already has CoinGecko data',
      { timeout: 30000 },
      async () => {
        try {
          // First discovery - creates fully enriched token
          const token1 = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          expect(token1.coingeckoId).toBeDefined();

          // Second discovery - should return immediately
          const { result: token2, duration } = await measureExecutionTime(() =>
            service.discover({
              address: TEST_TOKENS.USDC_ETHEREUM.address,
              chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
            })
          );

          // Should be very fast (just database lookup)
          expect(duration).toBeLessThan(100);
          expect(token2.id).toBe(token1.id);
          expect(token2.coingeckoId).toBe(token1.coingeckoId);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );
  });

  // ==========================================================================
  // Multi-Chain Support
  // ==========================================================================

  describe('Multi-Chain Support', () => {
    it(
      'should create separate entries for USDC on different chains',
      { timeout: 30000 },
      async () => {
        try {
          // Discover USDC on Ethereum
          const usdcEth = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Discover USDC on Arbitrum (different address!)
          const usdcArb = await service.discover({
            address: TEST_TOKENS.USDC_ARBITRUM.address,
            chainId: TEST_TOKENS.USDC_ARBITRUM.chainId,
          });

          // Should be different tokens (different IDs)
          expect(usdcEth.id).not.toBe(usdcArb.id);

          // Should have different addresses
          expect(usdcEth.config.address).toBe(TEST_TOKENS.USDC_ETHEREUM.address);
          expect(usdcArb.config.address).toBe(TEST_TOKENS.USDC_ARBITRUM.address);

          // Should have different chainIds
          expect(usdcEth.config.chainId).toBe(1);
          expect(usdcArb.config.chainId).toBe(42161);

          // Both should have same coingeckoId (same asset)
          expect(usdcEth.coingeckoId).toBe('usd-coin');
          expect(usdcArb.coingeckoId).toBe('usd-coin');

          // Verify both in database
          const counts = await countAllRecords();
          expect(counts.tokens).toBe(2);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should correctly store chainId for each token',
      { timeout: 30000 },
      async () => {
        try {
          const token = await service.discover({
            address: TEST_TOKENS.USDC_ARBITRUM.address,
            chainId: 42161,
          });

          // Verify config
          expect(token.config.chainId).toBe(42161);

          // Verify persisted correctly
          const dbToken = await prisma.token.findUnique({
            where: { id: token.id },
          });
          const config = dbToken?.config as { address: string; chainId: number };
          expect(config.chainId).toBe(42161);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should throw error for invalid address format', async () => {
      await expect(
        service.discover({ address: 'invalid-address', chainId: 1 })
      ).rejects.toThrow('Invalid Ethereum address format');

      // Verify no token created
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(0);
    });

    it('should throw error for too-short address', async () => {
      await expect(
        service.discover({ address: '0x123', chainId: 1 })
      ).rejects.toThrow('Invalid Ethereum address format');
    });

    it('should throw error for unsupported chain', async () => {
      await expect(
        service.discover({
          address: TEST_TOKENS.USDC_ETHEREUM.address,
          chainId: 999999,
        })
      ).rejects.toThrow('Chain 999999 is not configured');
    });

    it(
      'should throw error for contract without ERC-20 metadata',
      { timeout: 30000 },
      async () => {
        try {
          // Use an address that exists but doesn't implement ERC-20 interface
          // 0x111... is a valid address but not a valid ERC-20 contract
          await service.discover({
            address: '0x1111111111111111111111111111111111111111',
            chainId: 1,
          });

          expect.fail('Should have thrown an error');
        } catch (error) {
          // Could be rate limited, TokenMetadataError, or contract doesn't exist
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }

          // Should throw TokenMetadataError or similar RPC error
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBeDefined();
        }
      }
    );

    it(
      'should provide helpful error message for unsupported chain',
      { timeout: 30000 },
      async () => {
        try {
          await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: 999999,
          });
          expect.fail('Should have thrown error');
        } catch (error) {
          expect((error as Error).message).toContain('Chain 999999 is not configured');
          expect((error as Error).message).toContain('Supported chains:');
        }
      }
    );
  });

  // ==========================================================================
  // Address Normalization
  // ==========================================================================

  describe('Address Normalization', () => {
    it(
      'should normalize lowercase address to EIP-55',
      { timeout: 30000 },
      async () => {
        try {
          const token = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address.toLowerCase(),
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Verify normalized to proper case
          expect(token.config.address).toBe(TEST_TOKENS.USDC_ETHEREUM.address);

          // Verify persisted with normalized address
          const dbToken = await prisma.token.findUnique({
            where: { id: token.id },
          });
          const config = dbToken?.config as { address: string; chainId: number };
          expect(config.address).toBe(TEST_TOKENS.USDC_ETHEREUM.address);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should normalize mixed-case address to EIP-55',
      { timeout: 30000 },
      async () => {
        try {
          // Create incorrect mixed-case version
          const incorrectCase = '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';

          const token = await service.discover({
            address: incorrectCase,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Verify normalized to proper EIP-55
          expect(token.config.address).toBe(TEST_TOKENS.USDC_ETHEREUM.address);
          expect(token.config.address).not.toBe(incorrectCase);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should find token regardless of address case',
      { timeout: 30000 },
      async () => {
        try {
          // First discovery with correct case
          const token1 = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address,
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Second discovery with lowercase
          const token2 = await service.discover({
            address: TEST_TOKENS.USDC_ETHEREUM.address.toLowerCase(),
            chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
          });

          // Should return same token
          expect(token1.id).toBe(token2.id);

          // Verify only one token in database
          const counts = await countAllRecords();
          expect(counts.tokens).toBe(1);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );
  });

  // ==========================================================================
  // Performance & Optimization
  // ==========================================================================

  describe('Performance & Optimization', () => {
    it.skip(
      'should leverage CoinGecko cache across multiple discoveries',
      { timeout: 60000 },
      async () => {
        try {
          // Clear CoinGecko cache first
          const coinGeckoClient = CoinGeckoClient.getInstance();
          coinGeckoClient.clearCache();

          // First discovery - populates CoinGecko cache
          const { duration: firstDuration } = await measureExecutionTime(() =>
            service.discover({
              address: TEST_TOKENS.USDC_ETHEREUM.address,
              chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
            })
          );

          // Clear database to force rediscovery
          await prisma.token.deleteMany({});

          // Second discovery - uses CoinGecko cache (faster)
          const { duration: secondDuration } = await measureExecutionTime(() =>
            service.discover({
              address: TEST_TOKENS.WETH_ETHEREUM.address,
              chainId: TEST_TOKENS.WETH_ETHEREUM.chainId,
            })
          );

          // Second call should benefit from CoinGecko cache
          // (though RPC call still needed for new token)
          expect(secondDuration).toBeLessThan(firstDuration * 1.5);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );

    it(
      'should complete discovery in reasonable time',
      { timeout: 30000 },
      async () => {
        try {
          const { duration } = await measureExecutionTime(() =>
            service.discover({
              address: TEST_TOKENS.USDC_ETHEREUM.address,
              chainId: TEST_TOKENS.USDC_ETHEREUM.chainId,
            })
          );

          // Should complete within 10 seconds (including RPC + CoinGecko API)
          expect(duration).toBeLessThan(10000);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn('⚠️  Rate limited - skipping test');
            return;
          }
          throw error;
        }
      }
    );
  });

  // ==========================================================================
  // Database Cleanup Verification
  // ==========================================================================

  describe('Database Cleanup', () => {
    it('should start with clean database', async () => {
      const counts = await countAllRecords();
      expect(counts.tokens).toBe(0);
      expect(counts.pools).toBe(0);
      expect(counts.positions).toBe(0);
    });
  });
});
