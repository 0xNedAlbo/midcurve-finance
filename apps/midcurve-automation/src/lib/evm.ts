/**
 * EVM Client Utilities
 *
 * Provides viem public clients for reading pool prices and broadcasting transactions.
 * Delegates to EvmConfig from @midcurve/services (DB-backed via AppConfig).
 */

import { type PublicClient } from 'viem';
import { getEvmConfig } from '@midcurve/services';
import type { SupportedChainId } from './config';

// Re-export for convenience
export type { SupportedChainId } from './config';

/**
 * Get a public client for a specific chain.
 * Delegates to EvmConfig (initialized from AppConfig at startup).
 */
export function getPublicClient(chainId: SupportedChainId): PublicClient {
  return getEvmConfig().getPublicClient(chainId);
}

/**
 * UniswapV3 Pool ABI for slot0 read
 */
export const UNISWAP_V3_POOL_ABI = [
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Read current pool price (sqrtPriceX96)
 */
export async function readPoolPrice(
  chainId: SupportedChainId,
  poolAddress: `0x${string}`
): Promise<{ sqrtPriceX96: bigint; tick: number }> {
  const client = getPublicClient(chainId);

  const result = await client.readContract({
    address: poolAddress,
    abi: UNISWAP_V3_POOL_ABI,
    functionName: 'slot0',
  });

  return {
    sqrtPriceX96: result[0],
    tick: result[1],
  };
}

/**
 * Read pool fee tier from a Uniswap V3 pool
 *
 * @param chainId - Chain ID
 * @param poolAddress - Uniswap V3 pool address
 * @returns Fee tier (e.g. 500, 3000, 10000)
 */
export async function readPoolFee(
  chainId: SupportedChainId,
  poolAddress: `0x${string}`
): Promise<number> {
  const client = getPublicClient(chainId);

  const fee = await client.readContract({
    address: poolAddress,
    abi: UNISWAP_V3_POOL_FEE_ABI,
    functionName: 'fee',
  });

  return fee;
}

/**
 * Read current block number for a chain
 */
export async function readBlockNumber(chainId: SupportedChainId): Promise<bigint> {
  const client = getPublicClient(chainId);
  return client.getBlockNumber();
}

/**
 * Broadcast a signed transaction
 */
export async function broadcastTransaction(
  chainId: SupportedChainId,
  signedTx: `0x${string}`
): Promise<`0x${string}`> {
  const client = getPublicClient(chainId);
  const hash = await client.sendRawTransaction({ serializedTransaction: signedTx });
  return hash;
}

/**
 * Wait for transaction confirmation
 */
export async function waitForTransaction(
  chainId: SupportedChainId,
  txHash: `0x${string}`,
  confirmations = 1
): Promise<{
  blockNumber: bigint;
  gasUsed: bigint;
  status: 'success' | 'reverted';
}> {
  const client = getPublicClient(chainId);

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    confirmations,
    timeout: 60_000, // 60 second timeout
  });

  return {
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    status: receipt.status,
  };
}

/**
 * Get the revert reason for a failed transaction.
 *
 * Simulates the transaction at the block it was included to extract
 * the revert data, then decodes it to a human-readable message.
 *
 * @param chainId - Chain ID
 * @param txHash - Transaction hash
 * @returns Decoded revert reason, or null if unable to determine
 */
export async function getRevertReason(
  chainId: SupportedChainId,
  txHash: `0x${string}`
): Promise<string | null> {
  // Import here to avoid circular dependency
  const { decodeRevertReason } = await import('./error-decoder');
  const client = getPublicClient(chainId);

  try {
    // Get the original transaction
    const tx = await client.getTransaction({ hash: txHash });

    if (!tx) {
      return 'Transaction not found';
    }

    // Simulate the transaction at the block it was included
    // This will throw an error with the revert data
    await client.call({
      account: tx.from,
      to: tx.to,
      data: tx.input,
      value: tx.value,
      blockNumber: tx.blockNumber,
      gas: tx.gas,
    });

    // If call succeeded, something is unexpected
    return 'Transaction simulation succeeded (unexpected for reverted tx)';
  } catch (error) {
    // Extract revert data from error
    const err = error as Error & { data?: string; cause?: { data?: string } };

    // Try to get revert data from error
    let revertData = err.data || err.cause?.data;

    // Some RPC providers include the data in a different format
    if (!revertData && err.message) {
      // Try to extract hex data from error message
      const match = err.message.match(/0x[a-fA-F0-9]+/);
      if (match && match[0].length >= 10) {
        revertData = match[0];
      }
    }

    if (revertData) {
      return decodeRevertReason(revertData as `0x${string}`);
    }

    // Fallback to error message
    return err.message || 'Unknown revert reason';
  }
}

/**
 * Get the current on-chain nonce for an address.
 *
 * @param chainId - Chain ID
 * @param address - Wallet address
 * @returns Current nonce
 */
export async function getOnChainNonce(
  chainId: SupportedChainId,
  address: `0x${string}`
): Promise<number> {
  const client = getPublicClient(chainId);
  const nonce = await client.getTransactionCount({ address });
  return nonce;
}

// =============================================================================
// NFT-specific functions — re-exported from uniswapv3-nft-execution.ts
// These re-exports maintain backward compatibility during the refactor.
// New code should import directly from workers/uniswapv3/uniswapv3-nft-execution.
// =============================================================================

export {
  validateNftPosition as validatePositionForClose,
  simulateNftExecution as simulateExecuteOrder,
  getNftOnChainOrder as getOnChainOrder,
  readPositionData,
  type OnChainPositionData,
  type NftPreflightValidation as PreflightValidation,
  type OnChainOrderConfig,
} from '../workers/uniswapv3/uniswapv3-nft-execution';

/**
 * ERC20 ABI for balance checking
 */
const ERC20_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Check ERC20 token balance of an address
 *
 * @param chainId - Chain ID
 * @param tokenAddress - Token contract address
 * @param holderAddress - Address to check balance of
 * @returns Balance and symbol
 */
export async function checkTokenBalance(
  chainId: SupportedChainId,
  tokenAddress: `0x${string}`,
  holderAddress: `0x${string}`
): Promise<{ balance: bigint; symbol: string }> {
  const client = getPublicClient(chainId);

  const [balance, symbol] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [holderAddress],
    }),
    client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'symbol',
    }).catch(() => 'UNKNOWN'),
  ]);

  return { balance, symbol: symbol as string };
}

/**
 * Check balances of both tokens in a position for the PositionCloser contract
 *
 * @param chainId - Chain ID
 * @param token0 - Token0 address
 * @param token1 - Token1 address
 * @param contractAddress - PositionCloser contract address
 * @returns Balances of both tokens
 */
export async function checkContractTokenBalances(
  chainId: SupportedChainId,
  token0: `0x${string}`,
  token1: `0x${string}`,
  contractAddress: `0x${string}`
): Promise<{
  token0Balance: bigint;
  token0Symbol: string;
  token1Balance: bigint;
  token1Symbol: string;
}> {
  const [token0Data, token1Data] = await Promise.all([
    checkTokenBalance(chainId, token0, contractAddress),
    checkTokenBalance(chainId, token1, contractAddress),
  ]);

  return {
    token0Balance: token0Data.balance,
    token0Symbol: token0Data.symbol,
    token1Balance: token1Data.balance,
    token1Symbol: token1Data.symbol,
  };
}

/**
 * UniswapV3 Pool ABI for fee reading
 */
const UNISWAP_V3_POOL_FEE_ABI = [
  {
    inputs: [],
    name: 'fee',
    outputs: [{ internalType: 'uint24', name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Hop type for simulation swap params
 */
export interface SimulationHop {
  venueId: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  venueData: `0x${string}`;
}

/**
 * WithdrawParams for executeOrder (off-chain computed mins)
 */
export interface SimulationWithdrawParams {
  amount0Min: bigint;
  amount1Min: bigint;
}

/**
 * SwapParams for executeOrder (two-phase: guaranteed + surplus)
 */
export interface SimulationSwapParams {
  guaranteedAmountIn: bigint;
  minAmountOut: bigint;
  deadline: bigint;
  hops: SimulationHop[];
}

/**
 * FeeParams for executeOrder
 */
export interface SimulationFeeParams {
  feeRecipient: `0x${string}`;
  feeBps: number;
}

/**
 * Empty withdraw params (no slippage protection)
 */
export const EMPTY_WITHDRAW_PARAMS: SimulationWithdrawParams = {
  amount0Min: 0n,
  amount1Min: 0n,
};

/**
 * Empty swap params for no-swap execution
 */
export const EMPTY_SWAP_PARAMS: SimulationSwapParams = {
  guaranteedAmountIn: 0n,
  minAmountOut: 0n,
  deadline: 0n,
  hops: [],
};

/**
 * Empty fee params (no fee)
 */
export const EMPTY_FEE_PARAMS: SimulationFeeParams = {
  feeRecipient: '0x0000000000000000000000000000000000000000',
  feeBps: 0,
};

/**
 * Calculate minimum output amount for a direct pool swap (fallback mode)
 *
 * Uses the current pool price (sqrtPriceX96) and slippage tolerance to determine
 * the minimum acceptable output for direct pool swaps.
 *
 * @param srcAmount - Amount of source token to swap
 * @param sqrtPriceX96 - Current pool price as sqrtPriceX96
 * @param direction - Swap direction: 'TOKEN0_TO_1' or 'TOKEN1_TO_0'
 * @param token0Decimals - Decimals of token0
 * @param token1Decimals - Decimals of token1
 * @param slippageBps - Slippage tolerance in basis points (e.g., 100 = 1%)
 * @returns Minimum output amount with slippage applied
 */
export function calculatePoolSwapMinAmountOut(
  srcAmount: bigint,
  sqrtPriceX96: bigint,
  direction: 'TOKEN0_TO_1' | 'TOKEN1_TO_0',
  token0Decimals: number,
  token1Decimals: number,
  slippageBps: number
): bigint {
  // sqrtPriceX96 = sqrt(price) * 2^96
  // price = token1/token0 = (sqrtPriceX96 / 2^96)^2
  //
  // For TOKEN0_TO_1: expectedOut = srcAmount * price * (10^token1Decimals / 10^token0Decimals)
  //   = srcAmount * sqrtPriceX96^2 / 2^192 * 10^(token1Decimals - token0Decimals)
  //
  // For TOKEN1_TO_0: expectedOut = srcAmount / price * (10^token0Decimals / 10^token1Decimals)
  //   = srcAmount * 2^192 / sqrtPriceX96^2 * 10^(token0Decimals - token1Decimals)

  const Q96 = 1n << 96n;
  let expectedOut: bigint;

  if (direction === 'TOKEN0_TO_1') {
    // token0 → token1: multiply by price
    // expectedOut = srcAmount * sqrtPriceX96^2 / 2^192
    // Adjust for decimal difference
    const decimalDiff = token1Decimals - token0Decimals;
    const numerator = srcAmount * sqrtPriceX96 * sqrtPriceX96;
    expectedOut = numerator / (Q96 * Q96);
    if (decimalDiff > 0) {
      expectedOut = expectedOut * (10n ** BigInt(decimalDiff));
    } else if (decimalDiff < 0) {
      expectedOut = expectedOut / (10n ** BigInt(-decimalDiff));
    }
  } else {
    // token1 → token0: divide by price
    // expectedOut = srcAmount * 2^192 / sqrtPriceX96^2
    const decimalDiff = token0Decimals - token1Decimals;
    const numerator = srcAmount * Q96 * Q96;
    expectedOut = numerator / (sqrtPriceX96 * sqrtPriceX96);
    if (decimalDiff > 0) {
      expectedOut = expectedOut * (10n ** BigInt(decimalDiff));
    } else if (decimalDiff < 0) {
      expectedOut = expectedOut / (10n ** BigInt(-decimalDiff));
    }
  }

  // Apply slippage: minOut = expectedOut * (10000 - slippageBps) / 10000
  const minAmountOut = (expectedOut * BigInt(10000 - slippageBps)) / 10000n;

  return minAmountOut;
}

/**
 * Read the MidcurveSwapRouter address from the PositionCloser's ViewFacet.
 */
const VIEW_FACET_SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swapRouter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

export async function readSwapRouterAddress(
  chainId: SupportedChainId,
  contractAddress: `0x${string}`
): Promise<`0x${string}`> {
  const client = getPublicClient(chainId);

  return client.readContract({
    address: contractAddress,
    abi: VIEW_FACET_SWAP_ROUTER_ABI,
    functionName: 'swapRouter',
  });
}

/**
 * MidcurveSwapRouter ABI for reading adapter addresses
 */
const SWAP_ROUTER_GET_ADAPTER_ABI = [
  {
    type: 'function',
    name: 'getAdapter',
    stateMutability: 'view',
    inputs: [{ name: 'venueId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

/**
 * Read the ParaswapAdapter address from the MidcurveSwapRouter
 *
 * @param chainId - Chain ID
 * @param swapRouterAddress - MidcurveSwapRouter address
 * @returns ParaswapAdapter deployed address
 */
export async function readParaswapAdapterAddress(
  chainId: SupportedChainId,
  swapRouterAddress: `0x${string}`
): Promise<`0x${string}`> {
  const { keccak256, encodePacked } = await import('viem');
  const client = getPublicClient(chainId);

  const paraswapVenueId = keccak256(encodePacked(['string'], ['Paraswap']));

  return client.readContract({
    address: swapRouterAddress,
    abi: SWAP_ROUTER_GET_ADAPTER_ABI,
    functionName: 'getAdapter',
    args: [paraswapVenueId],
  });
}

/**
 * Compute WithdrawParams (amount0Min, amount1Min) off-chain
 *
 * Reads the current pool sqrtPriceX96, computes expected token amounts from
 * liquidity, and applies slippageBps to get minimum acceptable amounts.
 *
 * @param chainId - Chain ID
 * @param poolAddress - Uniswap V3 pool address
 * @param liquidity - Position liquidity
 * @param tickLower - Position lower tick
 * @param tickUpper - Position upper tick
 * @param slippageBps - Slippage tolerance in basis points
 * @returns WithdrawParams for executeOrder
 */
export async function computeWithdrawMinAmounts(
  chainId: SupportedChainId,
  poolAddress: `0x${string}`,
  liquidity: bigint,
  tickLower: number,
  tickUpper: number,
  slippageBps: number
): Promise<SimulationWithdrawParams> {
  const { getTokenAmountsFromLiquidity } = await import('@midcurve/shared');

  const { sqrtPriceX96 } = await readPoolPrice(chainId, poolAddress);

  const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper
  );

  const slippageMultiplier = BigInt(10000 - slippageBps);
  const amount0Min = (token0Amount * slippageMultiplier) / 10000n;
  const amount1Min = (token1Amount * slippageMultiplier) / 10000n;

  return { amount0Min, amount1Min };
}
