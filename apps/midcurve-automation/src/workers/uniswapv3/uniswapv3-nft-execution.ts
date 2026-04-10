/**
 * UniswapV3 NFT Position Closer — Execution Logic
 *
 * NFT-specific functions for executing close orders against the
 * UniswapV3PositionCloser contract. Extracted from lib/evm.ts to
 * separate NFT-specific logic from shared EVM utilities.
 *
 * Functions here interact with:
 * - NonfungiblePositionManager (NFPM) for position data, ownership, approval
 * - UniswapV3PositionCloser contract for order reading and simulation
 */

import { encodeFunctionData } from 'viem';
import {
  getPublicClient,
  type SupportedChainId,
  type SimulationWithdrawParams,
  type SimulationSwapParams,
  type SimulationFeeParams,
} from '../../lib/evm';

// =============================================================================
// Types
// =============================================================================

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
 * Pre-flight validation result for NFT close order execution
 */
export interface NftPreflightValidation {
  isValid: boolean;
  reason?: string;
  positionData?: OnChainPositionData;
  owner?: `0x${string}`;
  isApproved?: boolean;
  approvedAddress?: `0x${string}`;
  isApprovedForAll?: boolean;
}

/**
 * On-chain close order configuration (swap + slippage fields)
 */
export interface OnChainOrderConfig {
  /** Decrease liquidity slippage in basis points */
  slippageBps: number;
  /** SwapDirection enum: 0=NONE, 1=TOKEN0_TO_1, 2=TOKEN1_TO_0 */
  swapDirection: number;
  /** Swap slippage in basis points (fair value price protection) */
  swapSlippageBps: number;
}

// =============================================================================
// ABIs
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
 * PositionCloser ABI for executeOrder simulation and order reading
 *
 * executeOrder(uint256 nftId, uint8 triggerMode, WithdrawParams, SwapParams, FeeParams)
 */
const POSITION_CLOSER_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'nftId', type: 'uint256' },
      { internalType: 'uint8', name: 'triggerMode', type: 'uint8' },
      {
        internalType: 'struct IUniswapV3PositionCloserV1.WithdrawParams',
        name: 'withdrawParams',
        type: 'tuple',
        components: [
          { internalType: 'uint256', name: 'amount0Min', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Min', type: 'uint256' },
        ],
      },
      {
        internalType: 'struct IUniswapV3PositionCloserV1.SwapParams',
        name: 'swapParams',
        type: 'tuple',
        components: [
          { internalType: 'uint256', name: 'guaranteedAmountIn', type: 'uint256' },
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
      {
        internalType: 'struct IUniswapV3PositionCloserV1.FeeParams',
        name: 'feeParams',
        type: 'tuple',
        components: [
          { internalType: 'address', name: 'feeRecipient', type: 'address' },
          { internalType: 'uint16', name: 'feeBps', type: 'uint16' },
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
 * NonfungiblePositionManager addresses by chain ID
 */
const NFPM_ADDRESSES: Record<number, `0x${string}`> = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  42161: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  31337: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
};

// =============================================================================
// NFPM Reading
// =============================================================================

/**
 * Read position data from NonfungiblePositionManager
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
 */
async function readNftOwner(
  chainId: SupportedChainId,
  tokenId: bigint
): Promise<`0x${string}`> {
  const client = getPublicClient(chainId);
  const nfpmAddress = NFPM_ADDRESSES[chainId];

  if (!nfpmAddress) {
    throw new Error(`NFPM address not configured for chain ${chainId}`);
  }

  return client.readContract({
    address: nfpmAddress,
    abi: NFPM_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  });
}

/**
 * Check if contract is approved for NFT
 */
async function checkNftApproval(
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

// =============================================================================
// NFT Pre-flight Validation
// =============================================================================

/**
 * Validate NFT position state before close order execution.
 * Checks NFPM ownership, liquidity > 0, and NFT approval.
 */
export async function validateNftPosition(
  chainId: SupportedChainId,
  tokenId: bigint,
  expectedOwner: `0x${string}`,
  contractAddress: `0x${string}`
): Promise<NftPreflightValidation> {
  try {
    const [positionData, owner] = await Promise.all([
      readPositionData(chainId, tokenId),
      readNftOwner(chainId, tokenId),
    ]);

    if (owner.toLowerCase() !== expectedOwner.toLowerCase()) {
      return {
        isValid: false,
        reason: `NFT ownership changed. Expected: ${expectedOwner}, Actual: ${owner}`,
        positionData,
        owner,
      };
    }

    if (positionData.liquidity === 0n) {
      return {
        isValid: false,
        reason: `Position has zero liquidity. Token0: ${positionData.token0}, Token1: ${positionData.token1}`,
        positionData,
        owner,
      };
    }

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

// =============================================================================
// On-Chain Order Reading
// =============================================================================

/**
 * Read on-chain NFT close order configuration.
 * Used to determine slippage and swap config at execution time.
 */
export async function getNftOnChainOrder(
  chainId: SupportedChainId,
  contractAddress: `0x${string}`,
  nftId: bigint,
  triggerMode: number
): Promise<OnChainOrderConfig> {
  const client = getPublicClient(chainId);

  const result = await client.readContract({
    address: contractAddress,
    abi: POSITION_CLOSER_ABI,
    functionName: 'getOrder',
    args: [nftId, triggerMode],
  });

  return {
    slippageBps: Number(result.slippageBps),
    swapDirection: Number(result.swapDirection),
    swapSlippageBps: Number(result.swapSlippageBps),
  };
}

// =============================================================================
// Simulation
// =============================================================================

/**
 * Simulate NFT executeOrder transaction to catch errors before broadcasting.
 */
export async function simulateNftExecution(
  chainId: SupportedChainId,
  contractAddress: `0x${string}`,
  nftId: bigint,
  triggerMode: number,
  withdrawParams: SimulationWithdrawParams,
  swapParams: SimulationSwapParams,
  feeParams: SimulationFeeParams,
  operatorAddress: `0x${string}`
): Promise<{ success: boolean; error?: string; decodedError?: string }> {
  const { decodeRevertReason } = await import('../../lib/error-decoder');
  const client = getPublicClient(chainId);

  try {
    await client.simulateContract({
      address: contractAddress,
      abi: POSITION_CLOSER_ABI,
      functionName: 'executeOrder',
      args: [nftId, triggerMode, withdrawParams, swapParams, feeParams] as any,
      account: operatorAddress,
    });

    return { success: true };
  } catch (error) {
    const err = error as Error & { data?: unknown; cause?: { data?: unknown; cause?: { data?: unknown } } };

    let decodedError: string | undefined;

    if (err.message) {
      const reasonMatch = err.message.match(/reverted with the following reason:\s*\n([^\n]+)/);
      if (reasonMatch && reasonMatch[1]) {
        decodedError = reasonMatch[1].trim();
      }
    }

    if (!decodedError) {
      let revertData: unknown;
      let cursor: any = err;
      while (cursor && !revertData) {
        if (typeof cursor.raw === 'string' && cursor.raw.startsWith('0x') && cursor.raw.length >= 10) {
          revertData = cursor.raw;
          break;
        }
        if (typeof cursor.data === 'string' && cursor.data.startsWith('0x') && cursor.data.length >= 10) {
          revertData = cursor.data;
          break;
        }
        cursor = cursor.cause;
      }

      if (!revertData && err.message) {
        const match = err.message.match(/0x[a-fA-F0-9]+/);
        if (match && match[0].length >= 10) {
          revertData = match[0];
        }
      }

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

// =============================================================================
// Calldata Encoding (for signer)
// =============================================================================

/**
 * Encode NFT executeOrder calldata for signing.
 */
export function encodeNftExecuteOrderCalldata(params: {
  nftId: bigint;
  triggerMode: number;
  withdrawParams: SimulationWithdrawParams;
  swapParams: SimulationSwapParams;
  feeParams: SimulationFeeParams;
}): `0x${string}` {
  return encodeFunctionData({
    abi: POSITION_CLOSER_ABI,
    functionName: 'executeOrder',
    args: [
      params.nftId,
      params.triggerMode,
      params.withdrawParams,
      params.swapParams,
      params.feeParams,
    ],
  });
}
