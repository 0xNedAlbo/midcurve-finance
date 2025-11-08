/**
 * Uniswap V3 Pool Reader
 *
 * Utilities for reading pool configuration and state from Uniswap V3 contracts.
 * Uses viem's multicall for efficient batch reads.
 */

import type { PublicClient } from 'viem';
import { uniswapV3PoolAbi } from './pool-abi.js';
import type {
  UniswapV3PoolConfig,
  UniswapV3PoolState,
} from '@midcurve/shared';

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
 * Read pool configuration from a Uniswap V3 pool contract
 *
 * Uses viem's multicall to fetch immutable pool parameters (token0, token1, fee, tickSpacing)
 * in a single RPC call. This is more efficient than making four separate contract calls.
 *
 * @param client - Viem PublicClient configured for the correct chain
 * @param address - Pool contract address (must be checksummed)
 * @param chainId - Chain ID where the pool is deployed
 * @returns Pool configuration with immutable parameters
 * @throws PoolConfigError if contract doesn't implement Uniswap V3 pool interface
 *
 * @example
 * ```typescript
 * const client = evmConfig.getPublicClient(1);
 * const config = await readPoolConfig(
 *   client,
 *   '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
 *   1
 * );
 * // {
 * //   chainId: 1,
 * //   address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
 * //   token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
 * //   token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
 * //   feeBps: 3000,
 * //   tickSpacing: 60
 * // }
 * ```
 */
export async function readPoolConfig(
  client: PublicClient,
  address: string,
  chainId: number
): Promise<UniswapV3PoolConfig> {
  try {
    // Use multicall for efficient batch reading
    const results = await client.multicall({
      contracts: [
        {
          address: address as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'token0',
        },
        {
          address: address as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'token1',
        },
        {
          address: address as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'fee',
        },
        {
          address: address as `0x${string}`,
          abi: uniswapV3PoolAbi,
          functionName: 'tickSpacing',
        },
      ],
      allowFailure: false, // Throw if any call fails
    });

    // Extract results from multicall response
    const [token0, token1, fee, tickSpacing] = results;

    // Validate results
    if (typeof token0 !== 'string' || token0.length !== 42) {
      throw new PoolConfigError(
        `Pool contract returned invalid token0 address: ${token0}`,
        address
      );
    }

    if (typeof token1 !== 'string' || token1.length !== 42) {
      throw new PoolConfigError(
        `Pool contract returned invalid token1 address: ${token1}`,
        address
      );
    }

    if (typeof fee !== 'number' || fee < 0) {
      throw new PoolConfigError(
        `Pool contract returned invalid fee: ${fee}`,
        address
      );
    }

    if (typeof tickSpacing !== 'number') {
      throw new PoolConfigError(
        `Pool contract returned invalid tickSpacing: ${tickSpacing}`,
        address
      );
    }

    return {
      chainId,
      address,
      token0,
      token1,
      feeBps: fee,
      tickSpacing,
    };
  } catch (error) {
    // Re-throw PoolConfigError as-is
    if (error instanceof PoolConfigError) {
      throw error;
    }

    // Wrap other errors
    throw new PoolConfigError(
      `Failed to read pool configuration from ${address}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      address,
      error
    );
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
