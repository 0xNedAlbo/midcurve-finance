/**
 * Mock ParaSwap Client
 *
 * Provides the same interface as ParaswapClient but for local blockchain testing.
 * Instead of calling the ParaSwap API (which doesn't know about local tokens),
 * this client reads pool prices directly and generates swap calldata for the MockAugustus contract.
 *
 * Used only for chainId 31337 (local development chain).
 */

import { type Address, type Hex, encodeFunctionData, parseAbi } from 'viem';
import type { ParaswapPriceRoute } from '@midcurve/api-shared';
import { getEvmConfig, isLocalChain, SupportedChainId } from '../../config/evm.js';
import { logger } from '../../logging/index.js';
import type {
  ParaswapQuoteRequest,
  ParaswapQuoteResult,
  ParaswapBuildTxRequest,
  ParaswapTransactionResult,
  ParaswapSwapParams,
} from './paraswap-client.js';

const log = logger.child({ component: 'MockParaswapClient' });

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
    return isLocalChain(chainId);
  }

  /**
   * Get a swap quote (mimics ParaswapClient.getQuote)
   *
   * Reads pool price directly and calculates expected output.
   * Returns synthesized quote data suitable for the swap widget.
   */
  async getQuote(request: ParaswapQuoteRequest | MockParaswapQuoteRequest): Promise<ParaswapQuoteResult> {
    const chainId = request.chainId as number;

    if (!isLocalChain(chainId)) {
      throw new Error(`MockParaswapClient only supports chainId ${SupportedChainId.LOCAL}, got ${chainId}`);
    }

    log.info({
      chainId,
      srcToken: request.srcToken,
      destToken: request.destToken,
      amount: request.amount,
      slippageBps: request.slippageBps,
      msg: 'Getting mock quote',
    });

    // Get public client for local chain
    const publicClient = getEvmConfig().getPublicClient(chainId);

    // Calculate expected output from pool price
    const expectedOut = await this.getExpectedOutput(
      publicClient,
      request.srcToken,
      request.destToken,
      BigInt(request.amount)
    );

    // Apply slippage for minDestAmount
    const slippageBps = request.slippageBps ?? 50; // Default 0.5%
    const slippageMultiplier = 10000n - BigInt(slippageBps);
    const minDestAmount = (expectedOut * slippageMultiplier) / 10000n;

    log.info({
      chainId,
      srcToken: request.srcToken,
      destToken: request.destToken,
      srcAmount: request.amount,
      destAmount: expectedOut.toString(),
      minDestAmount: minDestAmount.toString(),
      msg: 'Mock quote generated',
    });

    return {
      priceRoute: {} as ParaswapPriceRoute, // Empty - not needed for mock execution
      srcToken: request.srcToken,
      destToken: request.destToken,
      srcAmount: request.amount,
      destAmount: expectedOut.toString(),
      minDestAmount: minDestAmount.toString(),
      priceImpact: 0, // Mock has no real price impact calculation
      gasCostUSD: '0', // Mock doesn't charge gas in USD terms
      gasCostWei: '0',
      augustusAddress: this.config.augustusAddress,
      tokenTransferProxy: this.config.augustusAddress, // MockAugustus is its own transfer proxy
      expiresAt: new Date(Date.now() + 300_000).toISOString(), // 5 min expiry
    };
  }

  /**
   * Build a swap transaction (mimics ParaswapClient.buildTransaction)
   *
   * Generates calldata for the MockAugustus.swap() function.
   */
  async buildTransaction(request: ParaswapBuildTxRequest): Promise<ParaswapTransactionResult> {
    const chainId = request.chainId as number;

    if (!isLocalChain(chainId)) {
      throw new Error(`MockParaswapClient only supports chainId ${SupportedChainId.LOCAL}, got ${chainId}`);
    }

    log.info({
      chainId,
      srcToken: request.srcToken,
      destToken: request.destToken,
      srcAmount: request.srcAmount,
      slippageBps: request.slippageBps,
      msg: 'Building mock transaction',
    });

    // Get public client to recalculate output (price may have changed)
    const publicClient = getEvmConfig().getPublicClient(chainId);

    // Calculate expected output
    const expectedOut = await this.getExpectedOutput(
      publicClient,
      request.srcToken,
      request.destToken,
      BigInt(request.srcAmount)
    );

    // Apply slippage
    const slippageMultiplier = 10000n - BigInt(request.slippageBps);
    const minDestAmount = (expectedOut * slippageMultiplier) / 10000n;

    // Encode swap calldata for MockAugustus
    const swapCalldata = encodeFunctionData({
      abi: MOCK_AUGUSTUS_ABI,
      functionName: 'swap',
      args: [request.srcToken, request.destToken, BigInt(request.srcAmount), minDestAmount],
    });

    log.info({
      chainId,
      to: this.config.augustusAddress,
      minDestAmount: minDestAmount.toString(),
      msg: 'Mock transaction built',
    });

    return {
      to: this.config.augustusAddress,
      data: swapCalldata as Hex,
      value: '0',
      gasLimit: '500000', // Conservative estimate for local chain
      minDestAmount: minDestAmount.toString(),
      deadline: Math.floor(Date.now() / 1000) + 300, // 5 min deadline
    };
  }

  /**
   * Get swap params (combined quote + transaction, used by automation)
   *
   * This method mimics ParaswapClient.getSwapParams but:
   * - Reads pool price directly instead of calling ParaSwap API
   * - Generates calldata for MockAugustus.swap() instead of ParaSwap
   */
  async getSwapParams(request: MockParaswapQuoteRequest): Promise<ParaswapSwapParams> {
    const { chainId, srcToken, destToken, amount, slippageBps } = request;

    if (!isLocalChain(chainId)) {
      throw new Error(`MockParaswapClient only supports chainId ${SupportedChainId.LOCAL}, got ${chainId}`);
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
    const publicClient = getEvmConfig().getPublicClient(chainId);

    // Calculate expected output from pool price
    const expectedOut = await this.getExpectedOutput(publicClient, srcToken, destToken, BigInt(amount));

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
 *
 * Required environment variables:
 * - MOCK_AUGUSTUS_ADDRESS: Address of the MockAugustus contract
 * - POOL_ADDRESS: Address of the UniswapV3 pool to use for price calculations
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

/**
 * Reset the mock client singleton (useful for testing)
 */
export function resetMockParaswapClient(): void {
  _mockParaswapClient = null;
}
