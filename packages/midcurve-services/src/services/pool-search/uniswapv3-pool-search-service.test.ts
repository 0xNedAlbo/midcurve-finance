import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@midcurve/database';
import { UniswapV3PoolSearchService } from './uniswapv3-pool-search-service.js';
import type { UniswapV3SubgraphClient, PoolSearchSubgraphResult } from '../../clients/subgraph/uniswapv3/index.js';
import type { CoingeckoTokenService } from '../coingecko-token/index.js';
import type { EvmConfig } from '../../config/evm.js';
import { PoolSigmaFilterService } from '../volatility/index.js';

/**
 * Service-layer tests for UniswapV3PoolSearchService — issue #45.
 *
 * The schema-level tests in @midcurve/api-shared cover request validation;
 * the UserSettings tests cover storage compat. These tests pin the
 * service-layer logic that's unique to the issue:
 *
 *  1. Per-chain orientation derivation — when the same symbol resolves to
 *     different on-chain addresses across chains (USDC@Mainnet vs USDC@Base,
 *     where USDC sorts as token0 on Mainnet but token1 on Base), each
 *     result must carry the correct per-chain `isToken0Quote`. This
 *     exercises the `Map<chainId, Set<address>>` introduced for the
 *     refinement.
 *
 *  2. Self-exclusion at the service layer — calling `searchPools` with a
 *     trivial same-token pair (e.g. base=["WETH"], quote=["WETH"]) must
 *     return [] gracefully without invoking the subgraph. The schema layer
 *     already rejects this as 400, but the service must remain robust to
 *     direct callers that bypass schema validation.
 */

// -----------------------------------------------------------------------------
// Fixtures (real EIP-55 addresses on Mainnet and Base)
// -----------------------------------------------------------------------------

const MAINNET = 1;
const BASE = 8453;

const USDC_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // sorts < WETH
const WETH_MAINNET = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH_BASE = '0x4200000000000000000000000000000000000006'; // sorts < USDC

function makeSubgraphPool(
  chainId: number,
  poolAddress: string,
  token0: { address: string; symbol: string; decimals: number },
  token1: { address: string; symbol: string; decimals: number },
): PoolSearchSubgraphResult {
  return {
    poolAddress,
    chainId,
    feeTier: 500,
    token0: { address: token0.address.toLowerCase(), symbol: token0.symbol, decimals: token0.decimals },
    token1: { address: token1.address.toLowerCase(), symbol: token1.symbol, decimals: token1.decimals },
    tvlUSD: '1000000',
    volume24hUSD: '0',
    fees24hUSD: '0',
    fees7dUSD: '0',
    volume7dAvgUSD: '0',
    fees7dAvgUSD: '0',
    apr7d: 0,
  };
}

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

interface Mocks {
  searchByTextAndChains: ReturnType<typeof vi.fn>;
  validateSubgraphFactory: ReturnType<typeof vi.fn>;
  searchPoolsByTokenSets: ReturnType<typeof vi.fn>;
  enrichPools: ReturnType<typeof vi.fn>;
  getChainConfig: ReturnType<typeof vi.fn>;
}

function buildService(mocks: Mocks): UniswapV3PoolSearchService {
  return new UniswapV3PoolSearchService({
    prisma: {} as unknown as PrismaClient,
    subgraphClient: {
      validateSubgraphFactory: mocks.validateSubgraphFactory,
      searchPoolsByTokenSets: mocks.searchPoolsByTokenSets,
    } as unknown as UniswapV3SubgraphClient,
    coingeckoTokenService: {
      searchByTextAndChains: mocks.searchByTextAndChains,
    } as unknown as CoingeckoTokenService,
    evmConfig: {
      getChainConfig: mocks.getChainConfig,
    } as unknown as EvmConfig,
    poolSigmaFilterService: {
      enrichPools: mocks.enrichPools,
    } as unknown as PoolSigmaFilterService,
  });
}

describe('UniswapV3PoolSearchService.searchPools — issue #45', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = {
      // Default: 'WETH' and 'USDC' resolve to per-chain addresses; everything
      // else is unknown (empty result). Tests can override per-test.
      searchByTextAndChains: vi.fn(async (text: string, _chainIds: number[]) => {
        if (text.toUpperCase() === 'WETH') {
          return [
            {
              symbol: 'WETH',
              name: 'Wrapped Ether',
              coingeckoId: 'weth',
              addresses: [
                { chainId: MAINNET, address: WETH_MAINNET },
                { chainId: BASE, address: WETH_BASE },
              ],
            },
          ];
        }
        if (text.toUpperCase() === 'USDC') {
          return [
            {
              symbol: 'USDC',
              name: 'USD Coin',
              coingeckoId: 'usd-coin',
              addresses: [
                { chainId: MAINNET, address: USDC_MAINNET },
                { chainId: BASE, address: USDC_BASE },
              ],
            },
          ];
        }
        return [];
      }),
      validateSubgraphFactory: vi.fn(async () => true),
      searchPoolsByTokenSets: vi.fn(async (chainId: number) => {
        if (chainId === MAINNET) {
          // Mainnet: USDC sorts lower than WETH → USDC = token0
          return [makeSubgraphPool(
            MAINNET,
            '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
            { address: USDC_MAINNET, symbol: 'USDC', decimals: 6 },
            { address: WETH_MAINNET, symbol: 'WETH', decimals: 18 },
          )];
        }
        if (chainId === BASE) {
          // Base: WETH (canonical wrapped-native at 0x4200…0006) sorts lower
          // than USDC → WETH = token0
          return [makeSubgraphPool(
            BASE,
            '0xd0b53D9277642d899DF5C87A3966A349A798F224',
            { address: WETH_BASE, symbol: 'WETH', decimals: 18 },
            { address: USDC_BASE, symbol: 'USDC', decimals: 6 },
          )];
        }
        return [];
      }),
      enrichPools: vi.fn(async () => new Map()),
      getChainConfig: vi.fn((chainId: number) => ({
        name: chainId === MAINNET ? 'Ethereum' : chainId === BASE ? 'Base' : `Chain ${chainId}`,
      })),
    };
  });

  // ---------------------------------------------------------------------------
  // Test 1: per-chain orientation derivation
  // ---------------------------------------------------------------------------

  describe('per-chain isToken0Quote derivation', () => {
    it('derives orientation per-chain when same symbol resolves to different addresses across chains', async () => {
      const service = buildService(mocks);

      const results = await service.searchPools({
        base: ['WETH'],
        quote: ['USDC'],
        chainIds: [MAINNET, BASE],
      });

      expect(results).toHaveLength(2);

      const mainnet = results.find((r) => r.chainId === MAINNET);
      const base = results.find((r) => r.chainId === BASE);

      // Mainnet pool: token0 = USDC ∈ quote → isToken0Quote = true
      expect(mainnet?.token0.address.toLowerCase()).toBe(USDC_MAINNET.toLowerCase());
      expect(mainnet?.userProvidedInfo).toEqual({ isToken0Quote: true });

      // Base pool: token0 = WETH ∈ base (NOT in quote) → isToken0Quote = false
      expect(base?.token0.address.toLowerCase()).toBe(WETH_BASE.toLowerCase());
      expect(base?.userProvidedInfo).toEqual({ isToken0Quote: false });
    });

    it('derives orientation correctly when role is reversed (USDC base, WETH quote)', async () => {
      const service = buildService(mocks);

      const results = await service.searchPools({
        base: ['USDC'],
        quote: ['WETH'],
        chainIds: [MAINNET, BASE],
      });

      expect(results).toHaveLength(2);

      const mainnet = results.find((r) => r.chainId === MAINNET);
      const base = results.find((r) => r.chainId === BASE);

      // Mainnet: token0 = USDC ∈ base (NOT quote) → isToken0Quote = false
      expect(mainnet?.userProvidedInfo).toEqual({ isToken0Quote: false });

      // Base: token0 = WETH ∈ quote → isToken0Quote = true
      expect(base?.userProvidedInfo).toEqual({ isToken0Quote: true });
    });

    it('passes the correct address sets to the subgraph per chain (not globally pooled)', async () => {
      const service = buildService(mocks);

      await service.searchPools({
        base: ['WETH'],
        quote: ['USDC'],
        chainIds: [MAINNET, BASE],
      });

      // searchPoolsByTokenSets(chainId, base, quote) — addresses are
      // lowercased and per-chain. Mainnet must see Mainnet addresses only,
      // Base must see Base addresses only.
      expect(mocks.searchPoolsByTokenSets).toHaveBeenCalledTimes(2);

      const mainnetCall = mocks.searchPoolsByTokenSets.mock.calls.find(
        (call) => call[0] === MAINNET,
      );
      const baseCall = mocks.searchPoolsByTokenSets.mock.calls.find(
        (call) => call[0] === BASE,
      );

      expect(mainnetCall?.[1]).toEqual([WETH_MAINNET.toLowerCase()]);
      expect(mainnetCall?.[2]).toEqual([USDC_MAINNET.toLowerCase()]);
      expect(baseCall?.[1]).toEqual([WETH_BASE.toLowerCase()]);
      expect(baseCall?.[2]).toEqual([USDC_BASE.toLowerCase()]);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: self-exclusion at the service layer
  // ---------------------------------------------------------------------------

  describe('per-chain self-exclusion (base ∩ quote)', () => {
    it('returns [] without invoking the subgraph when base=quote=[same symbol] (schema bypass)', async () => {
      const service = buildService(mocks);

      const results = await service.searchPools({
        base: ['WETH'],
        quote: ['WETH'],
        chainIds: [MAINNET],
      });

      expect(results).toEqual([]);
      // Self-exclusion runs before the subgraph call — no chain has a valid
      // (b, q) pair with b !== q, so we never reach searchPoolsByTokenSets.
      expect(mocks.searchPoolsByTokenSets).not.toHaveBeenCalled();
      expect(mocks.validateSubgraphFactory).not.toHaveBeenCalled();
    });

    it('keeps richer queries valid when base ⊃ quote partially', async () => {
      // base=["WETH","stETH"], quote=["WETH","stETH"] is a legitimate
      // "all WETH/stETH pools either orientation" query — the per-chain
      // (WETH, stETH) and (stETH, WETH) pairs survive self-exclusion.
      mocks.searchByTextAndChains.mockImplementation(async (text: string) => {
        if (text.toUpperCase() === 'WETH') {
          return [{
            symbol: 'WETH',
            name: 'Wrapped Ether',
            coingeckoId: 'weth',
            addresses: [{ chainId: MAINNET, address: WETH_MAINNET }],
          }];
        }
        if (text.toUpperCase() === 'STETH') {
          return [{
            symbol: 'stETH',
            name: 'Lido Staked Ether',
            coingeckoId: 'staked-ether',
            addresses: [{ chainId: MAINNET, address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' }],
          }];
        }
        return [];
      });

      // Service returns whatever the subgraph returns; we just need to
      // confirm the subgraph was called (i.e., self-exclusion did NOT
      // short-circuit the chain).
      mocks.searchPoolsByTokenSets.mockResolvedValue([]);

      const service = buildService(mocks);
      const results = await service.searchPools({
        base: ['WETH', 'stETH'],
        quote: ['WETH', 'stETH'],
        chainIds: [MAINNET],
      });

      expect(results).toEqual([]);
      expect(mocks.searchPoolsByTokenSets).toHaveBeenCalledTimes(1);
    });
  });
});
