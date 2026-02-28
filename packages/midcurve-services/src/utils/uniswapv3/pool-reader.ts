/**
 * Uniswap V3 Pool Reader
 *
 * Utilities for reading pool state from Uniswap V3 contracts.
 * Uses viem's multicall for efficient batch reads.
 *
 * Note: Pool configuration reading has been moved to UniswapV3PoolService.fetchPoolConfig()
 */

import type { PublicClient } from 'viem';
import { uniswapV3PoolAbi } from './pool-abi.js';
import { type UniswapV3PoolState } from '@midcurve/shared';

// Batch size for multicall chunking (matches nfpm-enumerator.ts convention)
const MULTICALL_BATCH_SIZE = 50;

/**
 * Result from a batch slot0 read
 */
export interface PoolSlot0Result {
  address: string;
  sqrtPriceX96: bigint;
  currentTick: number;
}

/**
 * Error thrown when pool configuration cannot be read from contract
 */
export class PoolConfigError extends Error {
  constructor(
    message: string,
    public readonly address: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PoolConfigError';
  }
}

/**
 * Error thrown when pool state cannot be read from contract
 */
export class PoolStateError extends Error {
  constructor(
    message: string,
    public readonly address: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PoolStateError';
  }
}

/**
 * Read pool state from a Uniswap V3 pool contract
 *
 * Uses viem's multicall to fetch mutable pool state (slot0, liquidity, feeGrowthGlobal)
 * in a single RPC call. This is more efficient than making separate contract calls.
 *
 * State fields:
 * - sqrtPriceX96: Current pool price in Q96 fixed-point format
 * - currentTick: Current price tick
 * - liquidity: Total active liquidity in the pool
 * - feeGrowthGlobal0X128: Global fee growth for token0 (Q128 fixed-point)
 * - feeGrowthGlobal1X128: Global fee growth for token1 (Q128 fixed-point)
 *
 * @param client - Viem PublicClient configured for the correct chain
 * @param address - Pool contract address (must be checksummed)
 * @returns Pool state with current on-chain values
 * @throws PoolStateError if contract doesn't implement Uniswap V3 pool interface
 *
 * @example
 * ```typescript
 * const client = evmConfig.getPublicClient(1);
 * const state = await readPoolState(
 *   client,
 *   '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
 * );
 * // {
 * //   sqrtPriceX96: 1234567890123456789n,
 * //   currentTick: 201234,
 * //   liquidity: 9876543210987654321n,
 * //   feeGrowthGlobal0: 1111111111111111111n,
 * //   feeGrowthGlobal1: 2222222222222222222n
 * // }
 * ```
 */
export async function readPoolState(
  client: PublicClient,
  address: string
): Promise<UniswapV3PoolState> {
  try {
    // Use multicall for efficient batch reading
    const results = await client.multicall({
      contracts: [
        {
          address: address as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'slot0',
        },
        {
          address: address as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'liquidity',
        },
        {
          address: address as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'feeGrowthGlobal0X128',
        },
        {
          address: address as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'feeGrowthGlobal1X128',
        },
      ],
      allowFailure: false, // Throw if any call fails
    });

    // Extract results from multicall response
    const [slot0Result, liquidityResult, feeGrowthGlobal0Result, feeGrowthGlobal1Result] = results;

    // slot0 returns a tuple: [sqrtPriceX96, tick, observationIndex, observationCardinality, observationCardinalityNext, feeProtocol, unlocked]
    // We only need the first two values
    if (!Array.isArray(slot0Result) || slot0Result.length < 2) {
      throw new PoolStateError(
        `Pool contract returned invalid slot0 data`,
        address
      );
    }

    const [sqrtPriceX96, currentTick] = slot0Result;

    // Validate sqrtPriceX96 is a bigint
    if (typeof sqrtPriceX96 !== 'bigint') {
      throw new PoolStateError(
        `Pool contract returned invalid sqrtPriceX96: ${sqrtPriceX96}`,
        address
      );
    }

    // Validate currentTick is a number
    if (typeof currentTick !== 'number') {
      throw new PoolStateError(
        `Pool contract returned invalid currentTick: ${currentTick}`,
        address
      );
    }

    // Validate liquidity is a bigint
    if (typeof liquidityResult !== 'bigint') {
      throw new PoolStateError(
        `Pool contract returned invalid liquidity: ${liquidityResult}`,
        address
      );
    }

    // Validate feeGrowthGlobal0X128 is a bigint
    if (typeof feeGrowthGlobal0Result !== 'bigint') {
      throw new PoolStateError(
        `Pool contract returned invalid feeGrowthGlobal0X128: ${feeGrowthGlobal0Result}`,
        address
      );
    }

    // Validate feeGrowthGlobal1X128 is a bigint
    if (typeof feeGrowthGlobal1Result !== 'bigint') {
      throw new PoolStateError(
        `Pool contract returned invalid feeGrowthGlobal1X128: ${feeGrowthGlobal1Result}`,
        address
      );
    }

    // Semantic validation: Check for non-existent pool
    // When a pool contract doesn't exist, the EVM returns zeros for storage reads.
    // sqrtPriceX96 === 0 is impossible for an initialized pool (minimum is MIN_SQRT_RATIO).
    if (sqrtPriceX96 === 0n) {
      throw new PoolStateError(
        `Pool at ${address} has zero sqrtPriceX96 - pool may not exist or is uninitialized`,
        address
      );
    }

    // Uniswap V3 constants for valid price range
    // These are the minimum and maximum values for sqrtPriceX96 in Uniswap V3
    const MIN_SQRT_RATIO = 4295128739n;
    const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

    if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO) {
      throw new PoolStateError(
        `Pool at ${address} has invalid sqrtPriceX96 (${sqrtPriceX96}) - value outside valid range`,
        address
      );
    }

    return {
      sqrtPriceX96,
      currentTick,
      liquidity: liquidityResult,
      feeGrowthGlobal0: feeGrowthGlobal0Result,
      feeGrowthGlobal1: feeGrowthGlobal1Result,
    };
  } catch (error) {
    // Re-throw PoolStateError as-is
    if (error instanceof PoolStateError) {
      throw error;
    }

    // Wrap other errors
    throw new PoolStateError(
      `Failed to read pool state from ${address}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      address,
      error
    );
  }
}

/**
 * Batch-read slot0 from multiple Uniswap V3 pool contracts.
 *
 * Lighter than readPoolState() — only reads slot0 (1 call per pool instead of 4).
 * Used by the daily M2M cron to get fresh sqrtPriceX96 for all active pools.
 *
 * @param client - Viem PublicClient configured for the correct chain
 * @param poolAddresses - Array of pool contract addresses (must be checksummed)
 * @param batchSize - Max pools per multicall (default 50)
 * @returns Array of slot0 results (same order as input)
 * @throws PoolStateError if any pool returns invalid data
 */
export async function readPoolSlot0Batch(
  client: PublicClient,
  poolAddresses: string[],
  batchSize = MULTICALL_BATCH_SIZE
): Promise<PoolSlot0Result[]> {
  if (poolAddresses.length === 0) return [];

  const results: PoolSlot0Result[] = [];

  // Chunk into batches
  for (let i = 0; i < poolAddresses.length; i += batchSize) {
    const batch = poolAddresses.slice(i, i + batchSize);

    const contracts = batch.map((address) => ({
      address: address as `0x${string}`,
      abi: uniswapV3PoolAbi,
      functionName: 'slot0' as const,
    }));

    const batchResults = await client.multicall({
      contracts,
      allowFailure: false,
    });

    // Uniswap V3 constants for valid price range
    const MIN_SQRT_RATIO = 4295128739n;
    const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

    for (let j = 0; j < batch.length; j++) {
      const address = batch[j]!;
      const slot0Result = batchResults[j];

      if (!Array.isArray(slot0Result) || slot0Result.length < 2) {
        throw new PoolStateError(`Pool contract returned invalid slot0 data`, address);
      }

      const [sqrtPriceX96, currentTick] = slot0Result;

      if (typeof sqrtPriceX96 !== 'bigint') {
        throw new PoolStateError(`Pool returned invalid sqrtPriceX96: ${sqrtPriceX96}`, address);
      }

      if (typeof currentTick !== 'number') {
        throw new PoolStateError(`Pool returned invalid currentTick: ${currentTick}`, address);
      }

      if (sqrtPriceX96 === 0n) {
        throw new PoolStateError(`Pool at ${address} has zero sqrtPriceX96`, address);
      }

      if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO) {
        throw new PoolStateError(
          `Pool at ${address} has invalid sqrtPriceX96 (${sqrtPriceX96})`,
          address
        );
      }

      results.push({ address, sqrtPriceX96, currentTick });
    }
  }

  return results;
}
