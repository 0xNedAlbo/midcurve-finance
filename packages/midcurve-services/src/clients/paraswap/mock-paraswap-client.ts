/**
 * Mock ParaSwap Client
 *
 * Provides the same interface as ParaswapClient but for local blockchain testing.
 * Uses Uniswap V3 QuoterV2 and SwapRouter02 for accurate quotes and execution
 * on forked mainnet environments.
 *
 * Key features:
 * - Automatically finds the right pool for any token pair (tries multiple fee tiers)
 * - Accurate quotes from QuoterV2 (accounts for liquidity depth and fees)
 * - Real execution via SwapRouter02 (same path as production swaps)
 *
 * Used only for chainId 31337 (local development chain with forked mainnet).
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
  side?: 'SELL' | 'BUY'; // SELL = fixed input, BUY = fixed output
}

interface MockParaswapConfig {
  // SwapRouter02 address - uses canonical mainnet address by default
  swapRouterAddress?: Address;
}

// =============================================================================
// Constants
// =============================================================================

// Uniswap V3 canonical addresses (same on all chains including mainnet forks)
const QUOTER_V2_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as Address;
const SWAP_ROUTER_ADDRESS = '0x68b3465833fb72A5BF767c15aA22Cbc16614626D' as Address;

// Fee tiers to try in order of most common usage
const FEE_TIERS = [3000, 500, 10000, 100] as const; // 0.3%, 0.05%, 1%, 0.01%

const QUOTER_V2_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
]);

// =============================================================================
// Client
// =============================================================================

export class MockParaswapClient {
  private swapRouterAddress: Address;

  constructor(config: MockParaswapConfig = {}) {
    this.swapRouterAddress = config.swapRouterAddress ?? SWAP_ROUTER_ADDRESS;
  }

  /**
   * Check if a chain is supported (only local chain)
   */
  isChainSupported(chainId: number): boolean {
    return isLocalChain(chainId);
  }

  /**
   * Get a swap quote using Uniswap V3 QuoterV2
   *
   * Automatically finds the right pool by trying multiple fee tiers.
   * Returns accurate quotes that account for liquidity depth and fees.
   */
  async getQuote(request: ParaswapQuoteRequest | MockParaswapQuoteRequest): Promise<ParaswapQuoteResult> {
    const chainId = request.chainId as number;

    if (!isLocalChain(chainId)) {
      throw new Error(`MockParaswapClient only supports chainId ${SupportedChainId.LOCAL}, got ${chainId}`);
    }

    // Get public client for local chain
    const publicClient = getEvmConfig().getPublicClient(chainId);

    // Determine swap side from request (default to SELL)
    const side = ('side' in request && request.side) || 'SELL';

    // Get quote from Uniswap V3 QuoterV2
    const quoteResult = await this.getQuoteFromUniswap(
      publicClient,
      request.srcToken as Address,
      request.destToken as Address,
      BigInt(request.amount),
      side as 'SELL' | 'BUY'
    );

    // Apply slippage
    const slippageBps = request.slippageBps ?? 50; // Default 0.5%
    const slippageMultiplier = 10000n - BigInt(slippageBps);

    // For SELL: minDestAmount = output * (1 - slippage)
    // For BUY: maxSrcAmount = input * (1 + slippage) - handled by frontend
    const minDestAmount =
      side === 'SELL'
        ? (quoteResult.amountOut * slippageMultiplier) / 10000n
        : quoteResult.amountOut; // For BUY, amountOut is exact

    log.info({
      chainId,
      srcToken: request.srcToken,
      destToken: request.destToken,
      side,
      srcAmount: quoteResult.amountIn.toString(),
      destAmount: quoteResult.amountOut.toString(),
      minDestAmount: minDestAmount.toString(),
      fee: quoteResult.fee,
      msg: 'Mock quote generated via QuoterV2',
    });

    return {
      // Store fee tier and side in priceRoute for use in buildTransaction
      priceRoute: { fee: quoteResult.fee, side } as unknown as ParaswapPriceRoute,
      srcToken: request.srcToken,
      destToken: request.destToken,
      srcAmount: quoteResult.amountIn.toString(),
      destAmount: quoteResult.amountOut.toString(),
      minDestAmount: minDestAmount.toString(),
      priceImpact: 0, // QuoterV2 doesn't return price impact directly
      gasCostUSD: '0', // Local chain doesn't charge real gas
      gasCostWei: quoteResult.gasEstimate.toString(),
      augustusAddress: this.swapRouterAddress, // SwapRouter02 is the "augustus" for mock
      tokenTransferProxy: this.swapRouterAddress, // SwapRouter02 handles transfers
      expiresAt: new Date(Date.now() + 300_000).toISOString(), // 5 min expiry
    };
  }

  /**
   * Build a swap transaction using Uniswap V3 SwapRouter02
   *
   * Generates calldata for the real Uniswap V3 SwapRouter02.
   * Uses the same execution path as production swaps.
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
      msg: 'Building mock transaction for SwapRouter02',
    });

    // Get public client for local chain
    const publicClient = getEvmConfig().getPublicClient(chainId);

    // Get fresh quote to determine fee tier and current output
    const quoteResult = await this.getQuoteFromUniswap(
      publicClient,
      request.srcToken as Address,
      request.destToken as Address,
      BigInt(request.srcAmount),
      'SELL'
    );

    // Apply slippage
    const slippageMultiplier = 10000n - BigInt(request.slippageBps);
    const minAmountOut = (quoteResult.amountOut * slippageMultiplier) / 10000n;

    // Encode SwapRouter02 calldata
    const swapCalldata = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: request.srcToken as Address,
          tokenOut: request.destToken as Address,
          fee: quoteResult.fee,
          recipient: request.userAddress as Address,
          amountIn: BigInt(request.srcAmount),
          amountOutMinimum: minAmountOut,
          sqrtPriceLimitX96: 0n, // No price limit
        },
      ],
    });

    log.info({
      chainId,
      to: this.swapRouterAddress,
      minDestAmount: minAmountOut.toString(),
      fee: quoteResult.fee,
      msg: 'Mock transaction built for SwapRouter02',
    });

    return {
      to: this.swapRouterAddress,
      data: swapCalldata as Hex,
      value: '0',
      gasLimit: '300000', // Conservative estimate
      minDestAmount: minAmountOut.toString(),
      deadline: Math.floor(Date.now() / 1000) + 300, // 5 min deadline
    };
  }

  /**
   * Get swap params (combined quote + transaction, used by automation)
   *
   * Uses Uniswap V3 QuoterV2 for quotes and SwapRouter02 for execution.
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
      msg: 'Getting mock swap params via QuoterV2',
    });

    // Get public client for local chain
    const publicClient = getEvmConfig().getPublicClient(chainId);

    // Get quote from Uniswap V3 QuoterV2
    const quoteResult = await this.getQuoteFromUniswap(
      publicClient,
      srcToken,
      destToken,
      BigInt(amount),
      'SELL'
    );

    // Apply slippage
    const slippageMultiplier = 10000n - BigInt(slippageBps);
    const minDestAmount = (quoteResult.amountOut * slippageMultiplier) / 10000n;

    // Encode SwapRouter02 calldata
    const swapCalldata = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: srcToken,
          tokenOut: destToken,
          fee: quoteResult.fee,
          recipient: request.userAddress,
          amountIn: BigInt(amount),
          amountOutMinimum: minDestAmount,
          sqrtPriceLimitX96: 0n, // No price limit
        },
      ],
    });

    log.info({
      chainId,
      srcToken,
      destToken,
      srcAmount: amount,
      destAmount: quoteResult.amountOut.toString(),
      minDestAmount: minDestAmount.toString(),
      fee: quoteResult.fee,
      msg: 'Mock swap params generated via QuoterV2',
    });

    return {
      augustusAddress: this.swapRouterAddress,
      spenderAddress: this.swapRouterAddress, // SwapRouter02 handles transfers
      swapCalldata: swapCalldata as Hex,
      srcToken,
      destToken,
      srcAmount: amount,
      destAmount: quoteResult.amountOut.toString(),
      minDestAmount: minDestAmount.toString(),
      swapAllBalanceOffset: 0, // Not used
    };
  }

  /**
   * Get quote from Uniswap V3 QuoterV2
   *
   * Tries multiple fee tiers to find a pool for the token pair.
   * Returns the best quote found (first successful fee tier).
   */
  private async getQuoteFromUniswap(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient: any,
    tokenIn: Address,
    tokenOut: Address,
    amount: bigint,
    side: 'SELL' | 'BUY' = 'SELL'
  ): Promise<{ amountOut: bigint; amountIn: bigint; fee: number; gasEstimate: bigint }> {
    // Try each fee tier until we find a working pool
    for (const fee of FEE_TIERS) {
      try {

        if (side === 'SELL') {
          // quoteExactInputSingle - fixed input, get output
          const result = await publicClient.simulateContract({
            address: QUOTER_V2_ADDRESS,
            abi: QUOTER_V2_ABI,
            functionName: 'quoteExactInputSingle',
            args: [
              {
                tokenIn,
                tokenOut,
                amountIn: amount,
                fee,
                sqrtPriceLimitX96: 0n, // No price limit
              },
            ],
          });

          const [amountOut, , , gasEstimate] = result.result as [
            bigint,
            bigint,
            number,
            bigint,
          ];

          return { amountOut, amountIn: amount, fee, gasEstimate };
        } else {
          // quoteExactOutputSingle - fixed output, get input
          const result = await publicClient.simulateContract({
            address: QUOTER_V2_ADDRESS,
            abi: QUOTER_V2_ABI,
            functionName: 'quoteExactOutputSingle',
            args: [
              {
                tokenIn,
                tokenOut,
                amount, // This is the desired output amount for BUY side
                fee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          });

          const [amountIn, , , gasEstimate] = result.result as [
            bigint,
            bigint,
            number,
            bigint,
          ];

          return { amountOut: amount, amountIn, fee, gasEstimate };
        }
      } catch {
        // Pool doesn't exist for this fee tier, try next
        continue;
      }
    }

    throw new Error(
      `No Uniswap V3 pool found for ${tokenIn} → ${tokenOut}. ` +
        `Tried fee tiers: ${FEE_TIERS.join(', ')}`
    );
  }
}

// =============================================================================
// Factory
// =============================================================================

let _mockParaswapClient: MockParaswapClient | null = null;

/**
 * Get MockParaswapClient singleton
 *
 * Uses Uniswap V3 QuoterV2 and SwapRouter02 at their canonical mainnet addresses.
 * No environment variables required - works automatically on any mainnet fork.
 *
 * Optional environment variable:
 * - MOCK_SWAP_ROUTER_ADDRESS: Override the SwapRouter02 address (for testing)
 */
export function getMockParaswapClient(): MockParaswapClient {
  if (!_mockParaswapClient) {
    const swapRouterOverride = process.env.MOCK_SWAP_ROUTER_ADDRESS;

    _mockParaswapClient = new MockParaswapClient({
      swapRouterAddress: swapRouterOverride ? (swapRouterOverride as Address) : undefined,
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
