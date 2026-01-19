/**
 * Mock Paraswap Client
 *
 * Provides the same interface as ParaswapClient but for local blockchain testing.
 * Instead of calling the Paraswap API (which doesn't know about mockUSD), this client
 * reads pool prices directly and generates swap calldata for the MockAugustus contract.
 *
 * Used only for chainId 31337 (local development chain).
 */

import { type Address, type Hex, encodeFunctionData, parseAbi } from 'viem';
import { getPublicClient } from '../lib/evm';
import type { ParaswapSwapParams } from '@midcurve/services';
import { automationLogger } from '../lib/logger';

const log = automationLogger.child({ component: 'MockParaswapClient' });

// =============================================================================
// Types
// =============================================================================

export interface MockParaswapQuoteRequest {
  chainId: number;
  srcToken: Address;
  srcDecimals: number;
  destToken: Address;
  destDecimals: number;
  amount: string; // Wei amount as string
  userAddress: Address; // Contract address that will execute the swap
  slippageBps: number; // 0-10000
}

interface MockParaswapConfig {
  augustusAddress: Address;
  poolAddress: Address;
}

// =============================================================================
// Constants
// =============================================================================

const LOCAL_CHAIN_ID = 31337;

const MOCK_AUGUSTUS_ABI = parseAbi([
  'function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) returns (uint256)',
  'function getTokenTransferProxy() view returns (address)',
]);

const UNISWAP_V3_POOL_ABI = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]);

// =============================================================================
// Client
// =============================================================================

export class MockParaswapClient {
  private config: MockParaswapConfig;

  constructor(config: MockParaswapConfig) {
    this.config = config;
  }

  /**
   * Check if a chain is supported (only local chain)
   */
  isChainSupported(chainId: number): boolean {
    return chainId === LOCAL_CHAIN_ID;
  }

  /**
   * Get swap params for the MockAugustus contract
   *
   * This method mimics ParaswapClient.getSwapParams but:
   * - Reads pool price directly instead of calling Paraswap API
   * - Generates calldata for MockAugustus.swap() instead of Paraswap
   */
  async getSwapParams(request: MockParaswapQuoteRequest): Promise<ParaswapSwapParams> {
    const { chainId, srcToken, destToken, amount, slippageBps } = request;

    if (chainId !== LOCAL_CHAIN_ID) {
      throw new Error(`MockParaswapClient only supports chainId ${LOCAL_CHAIN_ID}, got ${chainId}`);
    }

    log.info({
      chainId,
      srcToken,
      destToken,
      amount,
      slippageBps,
      poolAddress: this.config.poolAddress,
      msg: 'Getting mock swap params',
    });

    // Get public client for local chain
    const publicClient = getPublicClient(chainId);

    // Calculate expected output from pool price
    const expectedOut = await this.getExpectedOutput(
      publicClient,
      srcToken,
      destToken,
      BigInt(amount)
    );

    // Apply slippage
    const slippageMultiplier = 10000n - BigInt(slippageBps);
    const minDestAmount = (expectedOut * slippageMultiplier) / 10000n;

    // Encode swap calldata for MockAugustus
    const swapCalldata = encodeFunctionData({
      abi: MOCK_AUGUSTUS_ABI,
      functionName: 'swap',
      args: [srcToken, destToken, BigInt(amount), minDestAmount],
    });

    log.info({
      chainId,
      srcToken,
      destToken,
      srcAmount: amount,
      destAmount: expectedOut.toString(),
      minDestAmount: minDestAmount.toString(),
      augustusAddress: this.config.augustusAddress,
      msg: 'Mock swap params generated',
    });

    return {
      augustusAddress: this.config.augustusAddress,
      spenderAddress: this.config.augustusAddress, // MockAugustus is its own transfer proxy
      swapCalldata: swapCalldata as Hex,
      srcToken,
      destToken,
      srcAmount: amount,
      destAmount: expectedOut.toString(),
      minDestAmount: minDestAmount.toString(),
      swapAllBalanceOffset: 0, // Not used in mock
    };
  }

  /**
   * Calculate expected output amount based on pool price
   *
   * This is a simplified calculation that uses the pool's sqrtPriceX96
   * to estimate the output. It doesn't account for:
   * - Price impact from the swap
   * - Fees charged by the pool
   *
   * For local testing purposes, this is sufficient. The slippage tolerance
   * will handle any small discrepancies.
   */
  private async getExpectedOutput(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient: any,
    tokenIn: Address,
    _tokenOut: Address, // Used for interface consistency, direction determined by token0
    amountIn: bigint
  ): Promise<bigint> {
    // Read pool state
    const [slot0Result, token0] = await Promise.all([
      publicClient.readContract({
        address: this.config.poolAddress,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: 'slot0',
      }),
      publicClient.readContract({
        address: this.config.poolAddress,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: 'token0',
      }),
    ]);

    const sqrtPriceX96 = slot0Result[0] as bigint;
    const Q96 = 2n ** 96n;

    // Determine swap direction
    const zeroForOne = tokenIn.toLowerCase() === (token0 as string).toLowerCase();

    // Calculate output based on price
    // Note: This is a simplified calculation without accounting for price impact
    if (zeroForOne) {
      // token0 → token1
      // price = (sqrtPriceX96 / 2^96)^2 = token1/token0
      // amountOut = amountIn * price
      return (amountIn * sqrtPriceX96 * sqrtPriceX96) / (Q96 * Q96);
    } else {
      // token1 → token0
      // price = (2^96 / sqrtPriceX96)^2 = token0/token1
      // amountOut = amountIn / price = amountIn * (2^96 / sqrtPriceX96)^2
      return (amountIn * Q96 * Q96) / (sqrtPriceX96 * sqrtPriceX96);
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

let _mockParaswapClient: MockParaswapClient | null = null;

/**
 * Get MockParaswapClient singleton (requires environment variables)
 */
export function getMockParaswapClient(): MockParaswapClient {
  if (!_mockParaswapClient) {
    const augustusAddress = process.env.MOCK_AUGUSTUS_ADDRESS;
    const poolAddress = process.env.POOL_ADDRESS;

    if (!augustusAddress) {
      throw new Error('MOCK_AUGUSTUS_ADDRESS environment variable is required for MockParaswapClient');
    }
    if (!poolAddress) {
      throw new Error('POOL_ADDRESS environment variable is required for MockParaswapClient');
    }

    _mockParaswapClient = new MockParaswapClient({
      augustusAddress: augustusAddress as Address,
      poolAddress: poolAddress as Address,
    });
  }
  return _mockParaswapClient;
}
