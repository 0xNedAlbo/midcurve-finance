/**
 * EVM Client Utilities
 *
 * Provides viem public clients for reading pool prices and broadcasting transactions.
 */

import { createPublicClient, http, type PublicClient, type Chain } from 'viem';
import { mainnet, arbitrum, base, bsc, polygon, optimism, localhost } from 'viem/chains';
import type { SupportedChainId } from './config';

// Re-export for convenience
export type { SupportedChainId } from './config';

/**
 * Production chain configurations
 */
const PRODUCTION_CHAIN_CONFIGS: Record<number, { chain: Chain; rpcEnvVar: string }> = {
  1: { chain: mainnet, rpcEnvVar: 'RPC_URL_ETHEREUM' },
  42161: { chain: arbitrum, rpcEnvVar: 'RPC_URL_ARBITRUM' },
  8453: { chain: base, rpcEnvVar: 'RPC_URL_BASE' },
  56: { chain: bsc, rpcEnvVar: 'RPC_URL_BSC' },
  137: { chain: polygon, rpcEnvVar: 'RPC_URL_POLYGON' },
  10: { chain: optimism, rpcEnvVar: 'RPC_URL_OPTIMISM' },
};

/**
 * Local chain configuration (dev/test only)
 */
const LOCAL_CHAIN_CONFIGS: Record<number, { chain: Chain; rpcEnvVar: string }> = {
  31337: { chain: { ...localhost, id: 31337 }, rpcEnvVar: 'RPC_URL_LOCAL' },
};

/**
 * Chain configurations with RPC URLs from environment
 * Local chain is only included in non-production environments.
 */
const CHAIN_CONFIGS: Record<SupportedChainId, { chain: Chain; rpcEnvVar: string }> =
  process.env.NODE_ENV === 'production'
    ? (PRODUCTION_CHAIN_CONFIGS as Record<SupportedChainId, { chain: Chain; rpcEnvVar: string }>)
    : ({ ...PRODUCTION_CHAIN_CONFIGS, ...LOCAL_CHAIN_CONFIGS } as Record<
        SupportedChainId,
        { chain: Chain; rpcEnvVar: string }
      >);

/**
 * Cache for public clients (one per chain)
 */
const clientCache = new Map<SupportedChainId, PublicClient>();

/**
 * Get RPC URL for a chain from environment
 */
function getRpcUrl(chainId: SupportedChainId): string {
  const config = CHAIN_CONFIGS[chainId];
  const url = process.env[config.rpcEnvVar];

  if (!url) {
    throw new Error(`${config.rpcEnvVar} environment variable is required for chain ${chainId}`);
  }

  return url;
}

/**
 * Get a public client for a specific chain
 */
export function getPublicClient(chainId: SupportedChainId): PublicClient {
  const cached = clientCache.get(chainId);
  if (cached) {
    return cached;
  }

  const config = CHAIN_CONFIGS[chainId];
  const rpcUrl = getRpcUrl(chainId);

  const client = createPublicClient({
    chain: config.chain,
    transport: http(rpcUrl),
  });

  clientCache.set(chainId, client);
  return client;
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
// Position Data Reading (for pre-flight validation)
// =============================================================================

/**
 * NonfungiblePositionManager ABI for position data reading
 */
const NFPM_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'positions',
    outputs: [
      { internalType: 'uint96', name: 'nonce', type: 'uint96' },
      { internalType: 'address', name: 'operator', type: 'address' },
      { internalType: 'address', name: 'token0', type: 'address' },
      { internalType: 'address', name: 'token1', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
      { internalType: 'int24', name: 'tickLower', type: 'int24' },
      { internalType: 'int24', name: 'tickUpper', type: 'int24' },
      { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      { internalType: 'uint256', name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { internalType: 'uint256', name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { internalType: 'uint128', name: 'tokensOwed0', type: 'uint128' },
      { internalType: 'uint128', name: 'tokensOwed1', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
    ],
    name: 'getApproved',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'operator', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

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
 * NonfungiblePositionManager addresses by chain ID
 */
const NFPM_ADDRESSES: Record<number, `0x${string}`> = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  42161: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  10: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  137: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  56: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613',
  31337: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
};

/**
 * Position data from NonfungiblePositionManager
 */
export interface OnChainPositionData {
  nonce: bigint;
  operator: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

/**
 * Pre-flight validation result for close order execution
 */
export interface PreflightValidation {
  isValid: boolean;
  reason?: string;
  positionData?: OnChainPositionData;
  owner?: `0x${string}`;
  isApproved?: boolean;
  approvedAddress?: `0x${string}`;
  isApprovedForAll?: boolean;
}

/**
 * Read position data from NonfungiblePositionManager
 *
 * @param chainId - Chain ID
 * @param tokenId - NFT token ID
 * @returns Position data
 */
export async function readPositionData(
  chainId: SupportedChainId,
  tokenId: bigint
): Promise<OnChainPositionData> {
  const client = getPublicClient(chainId);
  const nfpmAddress = NFPM_ADDRESSES[chainId];

  if (!nfpmAddress) {
    throw new Error(`NFPM address not configured for chain ${chainId}`);
  }

  const result = await client.readContract({
    address: nfpmAddress,
    abi: NFPM_ABI,
    functionName: 'positions',
    args: [tokenId],
  });

  return {
    nonce: result[0],
    operator: result[1],
    token0: result[2],
    token1: result[3],
    fee: result[4],
    tickLower: result[5],
    tickUpper: result[6],
    liquidity: result[7],
    feeGrowthInside0LastX128: result[8],
    feeGrowthInside1LastX128: result[9],
    tokensOwed0: result[10],
    tokensOwed1: result[11],
  };
}

/**
 * Read NFT owner from NonfungiblePositionManager
 *
 * @param chainId - Chain ID
 * @param tokenId - NFT token ID
 * @returns Owner address
 */
export async function readNftOwner(
  chainId: SupportedChainId,
  tokenId: bigint
): Promise<`0x${string}`> {
  const client = getPublicClient(chainId);
  const nfpmAddress = NFPM_ADDRESSES[chainId];

  if (!nfpmAddress) {
    throw new Error(`NFPM address not configured for chain ${chainId}`);
  }

  const owner = await client.readContract({
    address: nfpmAddress,
    abi: NFPM_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  });

  return owner;
}

/**
 * Check if contract is approved for NFT
 *
 * @param chainId - Chain ID
 * @param tokenId - NFT token ID
 * @param owner - NFT owner address
 * @param contractAddress - Contract to check approval for
 * @returns Approval status
 */
export async function checkNftApproval(
  chainId: SupportedChainId,
  tokenId: bigint,
  owner: `0x${string}`,
  contractAddress: `0x${string}`
): Promise<{ isApproved: boolean; approvedAddress: `0x${string}`; isApprovedForAll: boolean }> {
  const client = getPublicClient(chainId);
  const nfpmAddress = NFPM_ADDRESSES[chainId];

  if (!nfpmAddress) {
    throw new Error(`NFPM address not configured for chain ${chainId}`);
  }

  const [approvedAddress, isApprovedForAll] = await Promise.all([
    client.readContract({
      address: nfpmAddress,
      abi: NFPM_ABI,
      functionName: 'getApproved',
      args: [tokenId],
    }),
    client.readContract({
      address: nfpmAddress,
      abi: NFPM_ABI,
      functionName: 'isApprovedForAll',
      args: [owner, contractAddress],
    }),
  ]);

  const isApproved = approvedAddress.toLowerCase() === contractAddress.toLowerCase() || isApprovedForAll;

  return { isApproved, approvedAddress, isApprovedForAll };
}

/**
 * Validate position state before close order execution
 *
 * @param chainId - Chain ID
 * @param tokenId - NFT token ID
 * @param expectedOwner - Expected owner address
 * @param contractAddress - PositionCloser contract address
 * @returns Validation result with detailed diagnostics
 */
export async function validatePositionForClose(
  chainId: SupportedChainId,
  tokenId: bigint,
  expectedOwner: `0x${string}`,
  contractAddress: `0x${string}`
): Promise<PreflightValidation> {
  try {
    // Read position data and owner in parallel
    const [positionData, owner] = await Promise.all([
      readPositionData(chainId, tokenId),
      readNftOwner(chainId, tokenId),
    ]);

    // Check owner matches
    if (owner.toLowerCase() !== expectedOwner.toLowerCase()) {
      return {
        isValid: false,
        reason: `NFT ownership changed. Expected: ${expectedOwner}, Actual: ${owner}`,
        positionData,
        owner,
      };
    }

    // Check liquidity > 0
    if (positionData.liquidity === 0n) {
      return {
        isValid: false,
        reason: `Position has zero liquidity. Token0: ${positionData.token0}, Token1: ${positionData.token1}`,
        positionData,
        owner,
      };
    }

    // Check approval
    const approvalStatus = await checkNftApproval(chainId, tokenId, owner, contractAddress);

    if (!approvalStatus.isApproved) {
      return {
        isValid: false,
        reason: `NFT not approved for contract. ApprovedAddress: ${approvalStatus.approvedAddress}, IsApprovedForAll: ${approvalStatus.isApprovedForAll}`,
        positionData,
        owner,
        ...approvalStatus,
      };
    }

    return {
      isValid: true,
      positionData,
      owner,
      ...approvalStatus,
    };
  } catch (error) {
    const err = error as Error;
    return {
      isValid: false,
      reason: `Failed to read position data: ${err.message}`,
    };
  }
}

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
 * PositionCloser ABI for executeOrder simulation and order reading
 */
const POSITION_CLOSER_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'nftId', type: 'uint256' },
      { internalType: 'uint8', name: 'triggerMode', type: 'uint8' },
      { internalType: 'address', name: 'feeRecipient', type: 'address' },
      { internalType: 'uint16', name: 'feeBps', type: 'uint16' },
      {
        internalType: 'struct IUniswapV3PositionCloserV1.SwapParams',
        name: 'swapParams',
        type: 'tuple',
        components: [
          { internalType: 'uint256', name: 'minAmountOut', type: 'uint256' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          {
            internalType: 'struct IMidcurveSwapRouter.Hop[]',
            name: 'hops',
            type: 'tuple[]',
            components: [
              { internalType: 'bytes32', name: 'venueId', type: 'bytes32' },
              { internalType: 'address', name: 'tokenIn', type: 'address' },
              { internalType: 'address', name: 'tokenOut', type: 'address' },
              { internalType: 'bytes', name: 'venueData', type: 'bytes' },
            ],
          },
        ],
      },
    ],
    name: 'executeOrder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'nftId', type: 'uint256' },
      { internalType: 'uint8', name: 'triggerMode', type: 'uint8' },
    ],
    name: 'getOrder',
    outputs: [
      {
        internalType: 'struct CloseOrder',
        name: 'order',
        type: 'tuple',
        components: [
          { internalType: 'enum OrderStatus', name: 'status', type: 'uint8' },
          { internalType: 'uint256', name: 'nftId', type: 'uint256' },
          { internalType: 'address', name: 'owner', type: 'address' },
          { internalType: 'address', name: 'pool', type: 'address' },
          { internalType: 'int24', name: 'triggerTick', type: 'int24' },
          { internalType: 'address', name: 'payout', type: 'address' },
          { internalType: 'address', name: 'operator', type: 'address' },
          { internalType: 'uint256', name: 'validUntil', type: 'uint256' },
          { internalType: 'uint16', name: 'slippageBps', type: 'uint16' },
          { internalType: 'enum SwapDirection', name: 'swapDirection', type: 'uint8' },
          { internalType: 'uint16', name: 'swapSlippageBps', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

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
 * Empty swap params for no-swap execution
 */
const EMPTY_SWAP_PARAMS: SimulationSwapParams = {
  minAmountOut: 0n,
  deadline: 0n,
  hops: [],
};

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
 * Swap params type for simulation
 */
export interface SimulationSwapParams {
  minAmountOut: bigint;
  deadline: bigint;
  hops: SimulationHop[];
}

/**
 * Simulate executeOrder transaction to catch errors before broadcasting
 *
 * @param chainId - Chain ID
 * @param contractAddress - PositionCloser contract address
 * @param nftId - Position NFT ID
 * @param triggerMode - Trigger mode (0=LOWER, 1=UPPER)
 * @param feeRecipient - Fee recipient address
 * @param feeBps - Fee in basis points
 * @param operatorAddress - Operator address (caller)
 * @param swapParams - Optional swap parameters (defaults to empty/no-swap)
 * @returns Simulation result
 */
export async function simulateExecuteOrder(
  chainId: SupportedChainId,
  contractAddress: `0x${string}`,
  nftId: bigint,
  triggerMode: number,
  feeRecipient: `0x${string}`,
  feeBps: number,
  operatorAddress: `0x${string}`,
  swapParams?: SimulationSwapParams
): Promise<{ success: boolean; error?: string; decodedError?: string }> {
  const { decodeRevertReason } = await import('./error-decoder');
  const client = getPublicClient(chainId);

  // Use empty swap params if not provided
  const swapParamsTuple = swapParams || EMPTY_SWAP_PARAMS;

  try {
    await client.simulateContract({
      address: contractAddress,
      abi: POSITION_CLOSER_ABI,
      functionName: 'executeOrder',
      args: [nftId, triggerMode, feeRecipient, feeBps, swapParamsTuple] as any,
      account: operatorAddress,
    });

    return { success: true };
  } catch (error) {
    const err = error as Error & { data?: unknown; cause?: { data?: unknown } };

    // First, try to extract the reason from viem's error message
    // viem formats it as: "reverted with the following reason:\n<REASON>\n"
    let decodedError: string | undefined;

    if (err.message) {
      const reasonMatch = err.message.match(/reverted with the following reason:\s*\n([^\n]+)/);
      if (reasonMatch && reasonMatch[1]) {
        decodedError = reasonMatch[1].trim();
      }
    }

    // If viem didn't decode it, try to extract raw revert data
    if (!decodedError) {
      let revertData: unknown = err.data || err.cause?.data;

      // Try to extract hex data from error message if no direct data
      if (!revertData && err.message) {
        const match = err.message.match(/0x[a-fA-F0-9]+/);
        if (match && match[0].length >= 10) {
          revertData = match[0];
        }
      }

      // decodeRevertReason handles unknown types gracefully
      decodedError = revertData
        ? decodeRevertReason(revertData)
        : err.message;
    }

    return {
      success: false,
      error: err.message,
      decodedError,
    };
  }
}

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
 * On-chain close order data (relevant swap fields)
 */
export interface OnChainCloseOrderSwapInfo {
  /** SwapDirection enum: 0=NONE, 1=TOKEN0_TO_1, 2=TOKEN1_TO_0 */
  swapDirection: number;
  /** Swap slippage in basis points */
  swapSlippageBps: number;
}

/**
 * Read on-chain order to get swap configuration
 *
 * This is used to determine if a swap is needed at execution time,
 * regardless of what's stored in the database.
 *
 * @param chainId - Chain ID
 * @param contractAddress - PositionCloser contract address
 * @param nftId - Position NFT ID
 * @param triggerMode - Trigger mode (0=LOWER, 1=UPPER)
 * @returns Swap configuration from on-chain order
 */
export async function getOnChainOrder(
  chainId: SupportedChainId,
  contractAddress: `0x${string}`,
  nftId: bigint,
  triggerMode: number
): Promise<OnChainCloseOrderSwapInfo> {
  const client = getPublicClient(chainId);

  const result = await client.readContract({
    address: contractAddress,
    abi: POSITION_CLOSER_ABI,
    functionName: 'getOrder',
    args: [nftId, triggerMode],
  });

  return {
    swapDirection: Number(result.swapDirection),
    swapSlippageBps: Number(result.swapSlippageBps),
  };
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
