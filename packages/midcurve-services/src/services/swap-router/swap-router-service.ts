/**
 * SwapRouterService
 *
 * Computes optimal post-close swap parameters for UniswapV3 position closures.
 * Implements a 7-phase algorithm:
 *   1. Position Analysis — determine tokens, amounts, direction
 *   2. Pool Discovery — find backbone (cached) and edge pools via multicall
 *   3. Path Enumeration — DFS through pool graph
 *   4. Local Math Quoting — rank paths by estimated output (no RPC)
 *   5. Fair Value & Slippage Floor — CoinGecko USD prices → absolute floor
 *   6. Execution Decision — compare best estimate vs floor
 *   7. Build Swap Instruction — encode hops for MidcurveSwapRouter.sell()
 */

import type { Address, PublicClient } from 'viem';
import { encodePacked, keccak256, encodeAbiParameters } from 'viem';
import {
  getTokenAmountsFromLiquidity,
  computeExpectedSwapOutput,
  FEE_TIERS,
  type SwapDirection,
} from '@midcurve/shared';

import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { EvmConfig } from '../../config/evm.js';
import {
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POSITION_MANAGER_ABI,
  getFactoryAddress,
  getPositionManagerAddress,
} from '../../config/uniswapv3.js';
import { uniswapV3PoolAbi } from '../../utils/uniswapv3/pool-abi.js';
import { CacheService } from '../cache/index.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import { CoinGeckoClient } from '../../clients/coingecko/coingecko-client.js';

import { MIDCURVE_SWAP_ROUTER_ABI } from './abi.js';
import {
  SwapTokenReadError,
  PositionReadError,
  PoolDiscoveryError,
} from './errors.js';
import type {
  PostCloseSwapInput,
  PostCloseSwapResult,
  FreeformSwapInput,
  FreeformSwapResult,
  SwapInstruction,
  DoNotExecute,
  SwapHop,
  DiscoveredPool,
  CandidatePath,
  PathHop,
  SwapDiagnostics,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** UniswapV3 venue identifier for MidcurveSwapRouter */
const UNISWAP_V3_VENUE_ID = keccak256(
  encodePacked(['string'], ['UniswapV3'])
) as `0x${string}`;

/** Cache TTL for swap tokens and backbone pools (1 hour) */
const BACKBONE_CACHE_TTL_SECONDS = 3600;

/** Safety margin on estimated input amount (0.5% less to avoid over-estimating) */
const AMOUNT_SAFETY_MARGIN_BPS = 50n; // 0.5%

/** Swap deadline offset from current block timestamp (5 minutes) */
const DEADLINE_OFFSET_SECONDS = 300n;

/** Zero address for pool existence checks */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// ============================================================================
// Dependencies
// ============================================================================

export interface SwapRouterServiceDependencies {
  evmConfig?: EvmConfig;
  coinGeckoClient?: CoinGeckoClient;
  erc20TokenService?: Erc20TokenService;
  cacheService?: CacheService;
}

// ============================================================================
// Service
// ============================================================================

export class SwapRouterService {
  private readonly evmConfig: EvmConfig;
  private readonly coinGeckoClient: CoinGeckoClient;
  private readonly erc20TokenService: Erc20TokenService;
  private readonly cacheService: CacheService;
  private readonly logger: ServiceLogger;

  constructor(dependencies: SwapRouterServiceDependencies = {}) {
    this.evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this.coinGeckoClient =
      dependencies.coinGeckoClient ?? CoinGeckoClient.getInstance();
    this.erc20TokenService =
      dependencies.erc20TokenService ?? new Erc20TokenService();
    this.cacheService =
      dependencies.cacheService ?? CacheService.getInstance();
    this.logger = createServiceLogger('SwapRouterService');
  }

  // ==========================================================================
  // Main Public Method
  // ==========================================================================

  /**
   * Compute optimal swap parameters for a post-close order swap.
   *
   * @param input - Post-close swap input parameters
   * @returns SwapInstruction to execute, or DoNotExecute if conditions are unfavorable
   */
  async computePostCloseSwapParams(
    input: PostCloseSwapInput
  ): Promise<PostCloseSwapResult> {
    log.methodEntry(this.logger, 'computePostCloseSwapParams', {
      chainId: input.chainId,
      nftId: input.nftId.toString(),
      swapDirection: input.swapDirection,
      maxDeviationBps: input.maxDeviationBps,
    });

    const maxHops = input.maxHops ?? 3;
    const client = this.evmConfig.getPublicClient(input.chainId);

    try {
      // ── Phase 1: Position Analysis ──────────────────────────────────
      const phase1 = await this._analyzePosition(client, input);
      if (phase1.kind === 'do_not_execute') {
        log.methodExit(this.logger, 'computePostCloseSwapParams', {
          result: 'do_not_execute',
          reason: phase1.reason,
        });
        return phase1;
      }

      const {
        tokenIn,
        tokenOut,
        estimatedAmountIn,
        tokenInDecimals,
        tokenOutDecimals,
        tokenInCoinGeckoId,
        tokenOutCoinGeckoId,
      } = phase1;

      // ── Phase 2: Pool Discovery ─────────────────────────────────────
      const { pools, swapTokens, backbonePoolsCacheHit, swapTokensCacheHit } =
        await this._discoverPools(
          client,
          input.chainId,
          input.swapRouterAddress,
          tokenIn,
          tokenOut
        );

      // ── Phase 3: Path Enumeration ───────────────────────────────────
      const candidatePaths = this._enumeratePaths(
        tokenIn,
        tokenOut,
        pools,
        maxHops
      );

      // ── Phase 4: Local Math Quoting ─────────────────────────────────
      const rankedPaths = this._quotePaths(candidatePaths, estimatedAmountIn);

      // ── Phase 5: Fair Value & Slippage Floor ────────────────────────
      const fairValue = await this._computeFairValueFloor(
        tokenInCoinGeckoId,
        tokenOutCoinGeckoId,
        estimatedAmountIn,
        tokenInDecimals,
        tokenOutDecimals,
        input.maxDeviationBps
      );

      // ── Phase 6: Execution Decision ─────────────────────────────────
      const diagnostics: SwapDiagnostics = {
        pathsEnumerated: candidatePaths.length,
        pathsQuoted: rankedPaths.length,
        bestEstimatedAmountOut:
          rankedPaths.length > 0 ? rankedPaths[0]!.estimatedOut : 0n,
        fairValuePrice: fairValue.fairPrice,
        absoluteFloorAmountOut: fairValue.absoluteFloor,
        tokenInUsdPrice: fairValue.tokenInUsdPrice,
        tokenOutUsdPrice: fairValue.tokenOutUsdPrice,
        intermediaryTokens: swapTokens,
        poolsDiscovered: pools.length,
        backbonePoolsCacheHit,
        swapTokensCacheHit,
      };

      if (rankedPaths.length === 0) {
        const result: DoNotExecute = {
          kind: 'do_not_execute',
          reason: 'No valid swap paths found',
          diagnostics,
        };
        log.methodExit(this.logger, 'computePostCloseSwapParams', {
          result: 'do_not_execute',
          reason: result.reason,
        });
        return result;
      }

      const bestPath = rankedPaths[0]!;

      if (
        fairValue.absoluteFloor > 0n &&
        bestPath.estimatedOut < fairValue.absoluteFloor
      ) {
        const result: DoNotExecute = {
          kind: 'do_not_execute',
          reason: `Best estimated output (${bestPath.estimatedOut}) is below fair value floor (${fairValue.absoluteFloor})`,
          diagnostics,
        };
        log.methodExit(this.logger, 'computePostCloseSwapParams', {
          result: 'do_not_execute',
          reason: result.reason,
        });
        return result;
      }

      // ── Phase 7: Build Swap Instruction ─────────────────────────────
      const hops = this._buildSwapHops(bestPath.path);

      // Use fair value floor as minAmountOut when available, otherwise use 0
      // (the contract will still enforce the minAmountOut from the signer)
      const minAmountOut =
        fairValue.absoluteFloor > 0n ? fairValue.absoluteFloor : 0n;

      const block = await client.getBlock();
      const deadline = block.timestamp + DEADLINE_OFFSET_SECONDS;

      const result: SwapInstruction = {
        kind: 'execute',
        tokenIn,
        tokenOut,
        estimatedAmountIn,
        minAmountOut,
        hops,
        deadline,
        diagnostics,
      };

      log.methodExit(this.logger, 'computePostCloseSwapParams', {
        result: 'execute',
        hopsCount: hops.length,
        estimatedAmountIn: estimatedAmountIn.toString(),
        minAmountOut: minAmountOut.toString(),
        bestEstimatedOut: bestPath.estimatedOut.toString(),
      });

      return result;
    } catch (error) {
      log.methodError(
        this.logger,
        'computePostCloseSwapParams',
        error as Error,
        {
          chainId: input.chainId,
          nftId: input.nftId.toString(),
        }
      );
      throw error;
    }
  }

  // ==========================================================================
  // Freeform Swap Quote (UI Swap Dialog)
  // ==========================================================================

  /**
   * Compute a freeform swap quote for the UI Swap Dialog.
   * Skips Phase 1 (position analysis) and directly accepts tokenIn/tokenOut/amount.
   * Reuses phases 2-7 from the post-close swap algorithm.
   *
   * @param input - Freeform swap input parameters
   * @returns SwapInstruction to execute, or DoNotExecute if conditions are unfavorable
   */
  async computeFreeformSwapQuote(
    input: FreeformSwapInput
  ): Promise<FreeformSwapResult> {
    log.methodEntry(this.logger, 'computeFreeformSwapQuote', {
      chainId: input.chainId,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn.toString(),
      maxDeviationBps: input.maxDeviationBps,
    });

    const maxHops = input.maxHops ?? 3;
    const client = this.evmConfig.getPublicClient(input.chainId);

    try {
      // Look up CoinGecko IDs for both tokens (for fair value floor)
      const [tokenInData, tokenOutData] = await Promise.all([
        this.erc20TokenService.findByAddressAndChain(
          input.tokenIn,
          input.chainId
        ),
        this.erc20TokenService.findByAddressAndChain(
          input.tokenOut,
          input.chainId
        ),
      ]);

      let tokenInCoinGeckoId: string | null =
        tokenInData?.coingeckoId ?? null;
      let tokenOutCoinGeckoId: string | null =
        tokenOutData?.coingeckoId ?? null;

      if (!tokenInCoinGeckoId) {
        tokenInCoinGeckoId = await this.coinGeckoClient.findCoinByAddress(
          input.chainId,
          input.tokenIn
        );
      }
      if (!tokenOutCoinGeckoId) {
        tokenOutCoinGeckoId = await this.coinGeckoClient.findCoinByAddress(
          input.chainId,
          input.tokenOut
        );
      }

      // ── Phase 2: Pool Discovery ─────────────────────────────────────
      const { pools, swapTokens, backbonePoolsCacheHit, swapTokensCacheHit } =
        await this._discoverPools(
          client,
          input.chainId,
          input.swapRouterAddress,
          input.tokenIn,
          input.tokenOut
        );

      // ── Phase 3: Path Enumeration ───────────────────────────────────
      const candidatePaths = this._enumeratePaths(
        input.tokenIn,
        input.tokenOut,
        pools,
        maxHops
      );

      // ── Phase 4: Local Math Quoting ─────────────────────────────────
      const rankedPaths = this._quotePaths(candidatePaths, input.amountIn);

      // ── Phase 5: Fair Value & Slippage Floor ────────────────────────
      const fairValue = await this._computeFairValueFloor(
        tokenInCoinGeckoId,
        tokenOutCoinGeckoId,
        input.amountIn,
        input.tokenInDecimals,
        input.tokenOutDecimals,
        input.maxDeviationBps
      );

      // ── Phase 6: Execution Decision ─────────────────────────────────
      const diagnostics: SwapDiagnostics = {
        pathsEnumerated: candidatePaths.length,
        pathsQuoted: rankedPaths.length,
        bestEstimatedAmountOut:
          rankedPaths.length > 0 ? rankedPaths[0]!.estimatedOut : 0n,
        fairValuePrice: fairValue.fairPrice,
        absoluteFloorAmountOut: fairValue.absoluteFloor,
        tokenInUsdPrice: fairValue.tokenInUsdPrice,
        tokenOutUsdPrice: fairValue.tokenOutUsdPrice,
        intermediaryTokens: swapTokens,
        poolsDiscovered: pools.length,
        backbonePoolsCacheHit,
        swapTokensCacheHit,
      };

      if (rankedPaths.length === 0) {
        const result: DoNotExecute = {
          kind: 'do_not_execute',
          reason: 'No valid swap paths found',
          diagnostics,
        };
        log.methodExit(this.logger, 'computeFreeformSwapQuote', {
          result: 'do_not_execute',
          reason: result.reason,
        });
        return result;
      }

      const bestPath = rankedPaths[0]!;

      // ── Phase 7: Build Swap Hops ──────────────────────────────────
      const hops = this._buildSwapHops(bestPath.path);

      if (
        fairValue.absoluteFloor > 0n &&
        bestPath.estimatedOut < fairValue.absoluteFloor
      ) {
        const result: DoNotExecute = {
          kind: 'do_not_execute',
          reason: `Best estimated output (${bestPath.estimatedOut}) is below fair value floor (${fairValue.absoluteFloor})`,
          hops,
          diagnostics,
        };
        log.methodExit(this.logger, 'computeFreeformSwapQuote', {
          result: 'do_not_execute',
          reason: result.reason,
          hopsCount: hops.length,
        });
        return result;
      }

      const minAmountOut =
        fairValue.absoluteFloor > 0n ? fairValue.absoluteFloor : 0n;

      const block = await client.getBlock();
      const deadline = block.timestamp + DEADLINE_OFFSET_SECONDS;

      const result: SwapInstruction = {
        kind: 'execute',
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        estimatedAmountIn: input.amountIn,
        minAmountOut,
        hops,
        deadline,
        diagnostics,
      };

      log.methodExit(this.logger, 'computeFreeformSwapQuote', {
        result: 'execute',
        hopsCount: hops.length,
        amountIn: input.amountIn.toString(),
        minAmountOut: minAmountOut.toString(),
        bestEstimatedOut: bestPath.estimatedOut.toString(),
      });

      return result;
    } catch (error) {
      log.methodError(
        this.logger,
        'computeFreeformSwapQuote',
        error as Error,
        {
          chainId: input.chainId,
          tokenIn: input.tokenIn,
          tokenOut: input.tokenOut,
        }
      );
      throw error;
    }
  }

  // ==========================================================================
  // Phase 1: Position Analysis
  // ==========================================================================

  private async _analyzePosition(
    client: PublicClient,
    input: PostCloseSwapInput
  ): Promise<
    | DoNotExecute
    | {
        kind: 'continue';
        tokenIn: Address;
        tokenOut: Address;
        estimatedAmountIn: bigint;
        tokenInDecimals: number;
        tokenOutDecimals: number;
        tokenInCoinGeckoId: string | null;
        tokenOutCoinGeckoId: string | null;
      }
  > {
    this.logger.debug('Phase 1: Analyzing position');

    // 1a. Read position data (use pre-fetched or fetch from NFPM)
    let token0: Address;
    let token1: Address;
    let fee: number;
    let tickLower: number;
    let tickUpper: number;
    let liquidity: bigint;
    let tokensOwed0: bigint;
    let tokensOwed1: bigint;

    if (input.positionData) {
      ({
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        liquidity,
        tokensOwed0,
        tokensOwed1,
      } = input.positionData);
    } else {
      try {
        const posManagerAddress = getPositionManagerAddress(input.chainId);
        const posData = await client.readContract({
          address: posManagerAddress,
          abi: UNISWAP_V3_POSITION_MANAGER_ABI,
          functionName: 'positions',
          args: [input.nftId],
        });
        [
          ,
          ,
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          liquidity,
          ,
          ,
          tokensOwed0,
          tokensOwed1,
        ] = posData;
      } catch (error) {
        throw new PositionReadError(input.chainId, input.nftId, error);
      }
    }

    // 1b. Read current pool price (use pre-fetched or fetch)
    let currentSqrtPriceX96: bigint;
    if (input.currentSqrtPriceX96) {
      currentSqrtPriceX96 = input.currentSqrtPriceX96;
    } else {
      const factoryAddress = getFactoryAddress(input.chainId);
      const poolAddress = (await client.readContract({
        address: factoryAddress,
        abi: UNISWAP_V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [token0, token1, fee],
      })) as Address;

      const slot0 = await client.readContract({
        address: poolAddress,
        abi: uniswapV3PoolAbi,
        functionName: 'slot0',
      });
      currentSqrtPriceX96 = slot0[0];
    }

    // 1c. Determine tokenIn/tokenOut from direction
    const tokenIn =
      input.swapDirection === 'TOKEN0_TO_1' ? token0 : token1;
    const tokenOut =
      input.swapDirection === 'TOKEN0_TO_1' ? token1 : token0;

    // 1d. Estimate swap amount from position
    const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
      liquidity,
      currentSqrtPriceX96,
      tickLower,
      tickUpper
    );

    const rawAmountIn =
      input.swapDirection === 'TOKEN0_TO_1'
        ? token0Amount + tokensOwed0
        : token1Amount + tokensOwed1;

    if (rawAmountIn === 0n) {
      return {
        kind: 'do_not_execute',
        reason: 'Position has zero amount to swap (100% in target token)',
        diagnostics: this._emptyDiagnostics(),
      };
    }

    // Apply safety margin (reduce by 0.5% to avoid over-estimating)
    const estimatedAmountIn =
      (rawAmountIn * (10000n - AMOUNT_SAFETY_MARGIN_BPS)) / 10000n;

    // 1e. Look up token metadata (decimals, coingeckoId) from DB
    const [tokenInData, tokenOutData] = await Promise.all([
      this.erc20TokenService.findByAddressAndChain(tokenIn, input.chainId),
      this.erc20TokenService.findByAddressAndChain(tokenOut, input.chainId),
    ]);

    const tokenInDecimals = tokenInData?.decimals ?? 18;
    const tokenOutDecimals = tokenOutData?.decimals ?? 18;

    // CoinGecko IDs: prefer DB, fall back to CoinGecko API
    let tokenInCoinGeckoId: string | null = tokenInData?.coingeckoId ?? null;
    let tokenOutCoinGeckoId: string | null = tokenOutData?.coingeckoId ?? null;

    if (!tokenInCoinGeckoId) {
      tokenInCoinGeckoId = await this.coinGeckoClient.findCoinByAddress(
        input.chainId,
        tokenIn
      );
    }
    if (!tokenOutCoinGeckoId) {
      tokenOutCoinGeckoId = await this.coinGeckoClient.findCoinByAddress(
        input.chainId,
        tokenOut
      );
    }

    return {
      kind: 'continue',
      tokenIn,
      tokenOut,
      estimatedAmountIn,
      tokenInDecimals,
      tokenOutDecimals,
      tokenInCoinGeckoId,
      tokenOutCoinGeckoId,
    };
  }

  // ==========================================================================
  // Phase 2: Pool Discovery
  // ==========================================================================

  private async _discoverPools(
    client: PublicClient,
    chainId: number,
    swapRouterAddress: Address,
    tokenIn: Address,
    tokenOut: Address
  ): Promise<{
    pools: DiscoveredPool[];
    swapTokens: Address[];
    backbonePoolsCacheHit: boolean;
    swapTokensCacheHit: boolean;
  }> {
    this.logger.debug('Phase 2: Discovering pools');

    // 2a. Get swap tokens (cached)
    const swapTokensCacheKey = `swap-router:swap-tokens:${chainId}:${swapRouterAddress.toLowerCase()}`;
    let swapTokens: Address[];
    let swapTokensCacheHit = false;

    const cachedSwapTokens =
      await this.cacheService.get<Address[]>(swapTokensCacheKey);
    if (cachedSwapTokens) {
      swapTokens = cachedSwapTokens;
      swapTokensCacheHit = true;
      log.cacheHit(this.logger, '_discoverPools', swapTokensCacheKey);
    } else {
      log.cacheMiss(this.logger, '_discoverPools', swapTokensCacheKey);
      try {
        swapTokens = (await client.readContract({
          address: swapRouterAddress,
          abi: MIDCURVE_SWAP_ROUTER_ABI,
          functionName: 'getSwapTokens',
        })) as Address[];
      } catch (error) {
        throw new SwapTokenReadError(chainId, swapRouterAddress, error);
      }
      await this.cacheService.set(
        swapTokensCacheKey,
        swapTokens,
        BACKBONE_CACHE_TTL_SECONDS
      );
    }

    const factoryAddress = getFactoryAddress(chainId);

    // 2b. Get backbone pools (swap token ↔ swap token, cached)
    const backboneCacheKey = `swap-router:backbone-pools:${chainId}:${swapRouterAddress.toLowerCase()}`;
    let backbonePools: DiscoveredPool[];
    let backbonePoolsCacheHit = false;

    const cachedBackbone =
      await this.cacheService.get<DiscoveredPool[]>(backboneCacheKey);
    if (cachedBackbone) {
      // Revive bigint values from JSON (CacheService serializes as strings)
      backbonePools = cachedBackbone.map((p) => ({
        ...p,
        liquidity: BigInt(p.liquidity),
        sqrtPriceX96: BigInt(p.sqrtPriceX96),
      }));
      backbonePoolsCacheHit = true;
      log.cacheHit(this.logger, '_discoverPools', backboneCacheKey);
    } else {
      log.cacheMiss(this.logger, '_discoverPools', backboneCacheKey);
      const backbonePairs = this._generateUniquePairs(swapTokens);
      backbonePools = await this._fetchPoolsForPairs(
        client,
        factoryAddress,
        backbonePairs
      );
      // Cache backbone pools (serialize bigints for JSON storage)
      const serializable = backbonePools.map((p) => ({
        ...p,
        liquidity: p.liquidity.toString(),
        sqrtPriceX96: p.sqrtPriceX96.toString(),
      }));
      await this.cacheService.set(
        backboneCacheKey,
        serializable,
        BACKBONE_CACHE_TTL_SECONDS
      );
    }

    // 2c. Discover edge pools (tokenIn/tokenOut ↔ swap tokens, fresh each time)
    const edgePairs: [Address, Address][] = [];

    // tokenIn ↔ swap tokens
    for (const st of swapTokens) {
      if (
        st.toLowerCase() !== tokenIn.toLowerCase() &&
        st.toLowerCase() !== tokenOut.toLowerCase()
      ) {
        edgePairs.push([tokenIn, st]);
        edgePairs.push([tokenOut, st]);
      }
    }
    // Also include the direct pair
    edgePairs.push([tokenIn, tokenOut]);

    const edgePools = await this._fetchPoolsForPairs(
      client,
      factoryAddress,
      edgePairs
    );

    // Merge backbone + edge, deduplicate by address
    const allPools = new Map<string, DiscoveredPool>();
    for (const pool of [...backbonePools, ...edgePools]) {
      allPools.set(pool.address.toLowerCase(), pool);
    }

    const pools = Array.from(allPools.values());
    this.logger.debug(
      {
        backbonePools: backbonePools.length,
        edgePools: edgePools.length,
        totalUnique: pools.length,
        swapTokens: swapTokens.length,
      },
      'Pool discovery complete'
    );

    return { pools, swapTokens, backbonePoolsCacheHit, swapTokensCacheHit };
  }

  /**
   * Fetch pools from UniswapV3 Factory for all given token pairs × all fee tiers.
   * Uses multicall for batch efficiency.
   */
  private async _fetchPoolsForPairs(
    client: PublicClient,
    factoryAddress: Address,
    pairs: [Address, Address][]
  ): Promise<DiscoveredPool[]> {
    if (pairs.length === 0) return [];

    // Step 1: Batch getPool calls for all pairs × fee tiers
    const getPoolCalls = pairs.flatMap(([tokenA, tokenB]) =>
      FEE_TIERS.map((fee) => ({
        address: factoryAddress,
        abi: UNISWAP_V3_FACTORY_ABI,
        functionName: 'getPool' as const,
        args: [tokenA, tokenB, fee] as const,
      }))
    );

    let poolAddressResults: readonly { result?: unknown; status: string }[];
    try {
      poolAddressResults = await client.multicall({
        contracts: getPoolCalls,
        allowFailure: true,
      });
    } catch (error) {
      throw new PoolDiscoveryError(
        0, // chainId not available here
        'edge',
        error
      );
    }

    // Step 2: Filter non-zero pool addresses
    const validPoolInfos: {
      address: Address;
      tokenA: Address;
      tokenB: Address;
      fee: number;
    }[] = [];

    for (let i = 0; i < poolAddressResults.length; i++) {
      const res = poolAddressResults[i]!;
      if (res.status === 'success' && res.result && res.result !== ZERO_ADDRESS) {
        const pairIndex = Math.floor(i / FEE_TIERS.length);
        const feeIndex = i % FEE_TIERS.length;
        const pair = pairs[pairIndex]!;
        validPoolInfos.push({
          address: res.result as Address,
          tokenA: pair[0],
          tokenB: pair[1],
          fee: FEE_TIERS[feeIndex] as number,
        });
      }
    }

    if (validPoolInfos.length === 0) return [];

    // Step 3: Batch read slot0 + liquidity for valid pools
    const stateCalls = validPoolInfos.flatMap((info) => [
      {
        address: info.address,
        abi: uniswapV3PoolAbi,
        functionName: 'slot0' as const,
      },
      {
        address: info.address,
        abi: uniswapV3PoolAbi,
        functionName: 'liquidity' as const,
      },
    ]);

    const stateResults = await client.multicall({
      contracts: stateCalls,
      allowFailure: true,
    });

    // Step 4: Assemble DiscoveredPool objects
    const pools: DiscoveredPool[] = [];
    for (let i = 0; i < validPoolInfos.length; i++) {
      const slot0Result = stateResults[i * 2]!;
      const liquidityResult = stateResults[i * 2 + 1]!;

      if (slot0Result.status !== 'success' || liquidityResult.status !== 'success') {
        continue;
      }

      const slot0 = slot0Result.result as readonly [bigint, number, number, number, number, number, boolean];
      const liq = liquidityResult.result as bigint;

      // Skip pools with zero liquidity
      if (liq === 0n) continue;

      const info = validPoolInfos[i]!;
      // Determine token0/token1 ordering
      const [t0, t1] =
        BigInt(info.tokenA) < BigInt(info.tokenB)
          ? [info.tokenA, info.tokenB]
          : [info.tokenB, info.tokenA];

      pools.push({
        address: info.address,
        token0: t0,
        token1: t1,
        fee: info.fee,
        liquidity: liq,
        sqrtPriceX96: slot0[0],
      });
    }

    return pools;
  }

  // ==========================================================================
  // Phase 3: Path Enumeration (DFS)
  // ==========================================================================

  private _enumeratePaths(
    tokenIn: Address,
    tokenOut: Address,
    pools: DiscoveredPool[],
    maxHops: number
  ): CandidatePath[] {
    this.logger.debug(
      { poolCount: pools.length, maxHops },
      'Phase 3: Enumerating paths'
    );

    // Build adjacency list: token → list of (pool, otherToken)
    const adjacency = new Map<
      string,
      { pool: DiscoveredPool; otherToken: Address }[]
    >();

    for (const pool of pools) {
      const t0 = pool.token0.toLowerCase();
      const t1 = pool.token1.toLowerCase();

      if (!adjacency.has(t0)) adjacency.set(t0, []);
      if (!adjacency.has(t1)) adjacency.set(t1, []);

      adjacency.get(t0)!.push({ pool, otherToken: pool.token1 });
      adjacency.get(t1)!.push({ pool, otherToken: pool.token0 });
    }

    const paths: CandidatePath[] = [];
    const visitedPools = new Set<string>();
    // Track visited tokens to prevent wasteful round-trips (e.g. A→B→A→C)
    // Going through the same token twice via different pools always loses fees.
    const visitedTokens = new Set<string>();
    visitedTokens.add(tokenIn.toLowerCase());

    const dfs = (
      currentToken: Address,
      currentHops: PathHop[]
    ) => {
      // Found target
      if (
        currentToken.toLowerCase() === tokenOut.toLowerCase() &&
        currentHops.length > 0
      ) {
        paths.push({ hops: [...currentHops] });
        return;
      }

      // Max depth reached
      if (currentHops.length >= maxHops) return;

      const neighbors = adjacency.get(currentToken.toLowerCase()) || [];
      for (const { pool, otherToken } of neighbors) {
        const poolKey = pool.address.toLowerCase();
        if (visitedPools.has(poolKey)) continue;

        const otherTokenKey = otherToken.toLowerCase();
        // Allow reaching tokenOut but prevent revisiting intermediate tokens
        if (otherTokenKey !== tokenOut.toLowerCase() && visitedTokens.has(otherTokenKey)) continue;

        visitedPools.add(poolKey);
        visitedTokens.add(otherTokenKey);
        currentHops.push({
          poolAddress: pool.address,
          tokenIn: currentToken,
          tokenOut: otherToken,
          fee: pool.fee,
          sqrtPriceX96: pool.sqrtPriceX96,
          token0: pool.token0,
        });

        dfs(otherToken, currentHops);

        currentHops.pop();
        visitedPools.delete(poolKey);
        visitedTokens.delete(otherTokenKey);
      }
    };

    dfs(tokenIn, []);

    this.logger.debug(
      { pathsFound: paths.length },
      'Path enumeration complete'
    );
    return paths;
  }

  // ==========================================================================
  // Phase 4: Local Math Quoting
  // ==========================================================================

  private _quotePaths(
    candidatePaths: CandidatePath[],
    amountIn: bigint
  ): { path: CandidatePath; estimatedOut: bigint }[] {
    this.logger.debug(
      { pathCount: candidatePaths.length },
      'Phase 4: Quoting paths with local math'
    );

    const results: { path: CandidatePath; estimatedOut: bigint }[] = [];

    for (const path of candidatePaths) {
      let currentAmount = amountIn;
      let valid = true;

      for (const hop of path.hops) {
        // Determine direction: is tokenIn the pool's token0?
        const direction: SwapDirection =
          hop.tokenIn.toLowerCase() === hop.token0.toLowerCase()
            ? 'TOKEN0_TO_1'
            : 'TOKEN1_TO_0';

        currentAmount = computeExpectedSwapOutput(
          currentAmount,
          hop.sqrtPriceX96,
          hop.fee,
          direction
        );

        if (currentAmount === 0n) {
          valid = false;
          break;
        }
      }

      if (valid && currentAmount > 0n) {
        results.push({ path, estimatedOut: currentAmount });
      }
    }

    // Sort descending by estimated output (best first)
    results.sort((a, b) => {
      if (b.estimatedOut > a.estimatedOut) return 1;
      if (b.estimatedOut < a.estimatedOut) return -1;
      return 0;
    });

    return results;
  }

  // ==========================================================================
  // Phase 5: Fair Value & Slippage Floor
  // ==========================================================================

  private async _computeFairValueFloor(
    tokenInCoinGeckoId: string | null,
    tokenOutCoinGeckoId: string | null,
    amountIn: bigint,
    tokenInDecimals: number,
    tokenOutDecimals: number,
    maxDeviationBps: number
  ): Promise<{
    fairPrice: number | null;
    absoluteFloor: bigint;
    tokenInUsdPrice: number | null;
    tokenOutUsdPrice: number | null;
  }> {
    this.logger.debug('Phase 5: Computing fair value floor');

    // If we can't get CoinGecko IDs for both tokens, we can't compute fair value
    if (!tokenInCoinGeckoId || !tokenOutCoinGeckoId) {
      this.logger.warn(
        {
          tokenInCoinGeckoId,
          tokenOutCoinGeckoId,
        },
        'Cannot compute fair value: missing CoinGecko IDs for one or both tokens'
      );
      return {
        fairPrice: null,
        absoluteFloor: 0n,
        tokenInUsdPrice: null,
        tokenOutUsdPrice: null,
      };
    }

    try {
      const prices = await this.coinGeckoClient.getSimplePrices([
        tokenInCoinGeckoId,
        tokenOutCoinGeckoId,
      ]);

      const tokenInUsdPrice = prices[tokenInCoinGeckoId]?.usd ?? null;
      const tokenOutUsdPrice = prices[tokenOutCoinGeckoId]?.usd ?? null;

      if (tokenInUsdPrice === null || tokenOutUsdPrice === null || tokenOutUsdPrice === 0) {
        this.logger.warn(
          { tokenInUsdPrice, tokenOutUsdPrice },
          'Cannot compute fair value: missing or zero USD prices'
        );
        return {
          fairPrice: null,
          absoluteFloor: 0n,
          tokenInUsdPrice,
          tokenOutUsdPrice,
        };
      }

      // Fair price ratio: how many tokenOut per tokenIn (in human units)
      const fairPrice = tokenInUsdPrice / tokenOutUsdPrice;

      // Compute fair value output in raw units:
      // fairValueOut = amountIn * fairPrice * (10^tokenOutDecimals / 10^tokenInDecimals)
      // We use integer math to avoid floating point precision issues.
      // Multiply by 1e18 precision factor, then divide back.
      const PRECISION = 10n ** 18n;
      const fairPriceScaled = BigInt(Math.floor(fairPrice * 1e18));
      const decimalAdjustment =
        10n ** BigInt(tokenOutDecimals) / 10n ** BigInt(tokenInDecimals);

      // fairValueOut = amountIn * fairPriceScaled * decimalAdjustment / PRECISION
      // Handle case where tokenOutDecimals < tokenInDecimals
      let fairValueOut: bigint;
      if (tokenOutDecimals >= tokenInDecimals) {
        fairValueOut =
          (amountIn * fairPriceScaled * decimalAdjustment) / PRECISION;
      } else {
        // decimalAdjustment would be 0 with integer division, so compute differently
        const decimalDiff = BigInt(tokenInDecimals - tokenOutDecimals);
        fairValueOut =
          (amountIn * fairPriceScaled) / (PRECISION * 10n ** decimalDiff);
      }

      // Apply max deviation: absoluteFloor = fairValueOut * (10000 - maxDeviationBps) / 10000
      const absoluteFloor =
        (fairValueOut * BigInt(10000 - maxDeviationBps)) / 10000n;

      this.logger.debug(
        {
          fairPrice,
          tokenInUsdPrice,
          tokenOutUsdPrice,
          fairValueOut: fairValueOut.toString(),
          absoluteFloor: absoluteFloor.toString(),
          maxDeviationBps,
        },
        'Fair value floor computed'
      );

      return {
        fairPrice,
        absoluteFloor,
        tokenInUsdPrice,
        tokenOutUsdPrice,
      };
    } catch (error) {
      this.logger.warn(
        { error },
        'Failed to compute fair value floor — proceeding without floor'
      );
      return {
        fairPrice: null,
        absoluteFloor: 0n,
        tokenInUsdPrice: null,
        tokenOutUsdPrice: null,
      };
    }
  }

  // ==========================================================================
  // Phase 7: Build Swap Instruction Hops
  // ==========================================================================

  private _buildSwapHops(path: CandidatePath): SwapHop[] {
    return path.hops.map((hop) => ({
      venueId: UNISWAP_V3_VENUE_ID,
      tokenIn: hop.tokenIn,
      tokenOut: hop.tokenOut,
      venueData: encodeAbiParameters(
        [{ type: 'uint24' }],
        [hop.fee]
      ) as `0x${string}`,
    }));
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Generate all unique unordered pairs from a list of addresses.
   */
  private _generateUniquePairs(tokens: Address[]): [Address, Address][] {
    const pairs: [Address, Address][] = [];
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        pairs.push([tokens[i]!, tokens[j]!]);
      }
    }
    return pairs;
  }

  /**
   * Return empty diagnostics for early-exit cases.
   */
  private _emptyDiagnostics(): SwapDiagnostics {
    return {
      pathsEnumerated: 0,
      pathsQuoted: 0,
      bestEstimatedAmountOut: 0n,
      fairValuePrice: null,
      absoluteFloorAmountOut: 0n,
      tokenInUsdPrice: null,
      tokenOutUsdPrice: null,
      intermediaryTokens: [],
      poolsDiscovered: 0,
      backbonePoolsCacheHit: false,
      swapTokensCacheHit: false,
    };
  }
}
