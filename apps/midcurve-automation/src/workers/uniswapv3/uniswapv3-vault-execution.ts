/**
 * UniswapV3 Vault Position Closer — Execution Logic
 *
 * Vault-specific functions for executing close orders against the
 * UniswapV3VaultPositionCloser contract.
 *
 * Functions here interact with:
 * - UniswapV3Vault ERC-20 for share balance, allowance, and vault state
 * - UniswapV3VaultPositionCloser contract for order reading and simulation
 * - NonfungiblePositionManager (via vault.positionManager + vault.tokenId) for liquidity data
 */

import { encodeFunctionData } from 'viem';
import {
  getPublicClient,
  computeWithdrawMinAmounts,
  type SupportedChainId,
  type SimulationWithdrawParams,
  type SimulationSwapParams,
  type SimulationFeeParams,
} from '../../lib/evm';
import type { OnChainOrderConfig } from './uniswapv3-nft-execution';

export type { OnChainOrderConfig };

// =============================================================================
// Types
// =============================================================================

/**
 * Vault pre-flight data for withdraw min computation
 */
export interface VaultPreflightData {
  sharesBalance: bigint;
  sharesToClose: bigint;
  totalSupply: bigint;
  allowance: bigint;
  vaultLiquidity: bigint;
  tickLower: number;
  tickUpper: number;
  token0: `0x${string}`;
  token1: `0x${string}`;
}

/**
 * Pre-flight validation result for vault close order execution
 */
export interface VaultPreflightValidation {
  isValid: boolean;
  reason?: string;
  owner?: `0x${string}`;
  isApproved?: boolean;
  vaultData?: VaultPreflightData;
}

// =============================================================================
// ABIs
// =============================================================================

/**
 * VaultPositionCloser ABI for executeOrder simulation and order reading
 *
 * executeOrder(address vault, address owner, uint8 triggerMode, WithdrawParams, SwapParams, FeeParams)
 */
const VAULT_POSITION_CLOSER_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'vault', type: 'address' },
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'uint8', name: 'triggerMode', type: 'uint8' },
      {
        internalType: 'struct IUniswapV3VaultPositionCloserV1.WithdrawParams',
        name: 'withdrawParams',
        type: 'tuple',
        components: [
          { internalType: 'uint256', name: 'amount0Min', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Min', type: 'uint256' },
        ],
      },
      {
        internalType: 'struct IUniswapV3VaultPositionCloserV1.SwapParams',
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
        internalType: 'struct IUniswapV3VaultPositionCloserV1.FeeParams',
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
      { internalType: 'address', name: 'vault', type: 'address' },
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'uint8', name: 'triggerMode', type: 'uint8' },
    ],
    name: 'getOrder',
    outputs: [
      {
        internalType: 'struct VaultCloseOrder',
        name: 'order',
        type: 'tuple',
        components: [
          { internalType: 'enum OrderStatus', name: 'status', type: 'uint8' },
          { internalType: 'address', name: 'vault', type: 'address' },
          { internalType: 'address', name: 'owner', type: 'address' },
          { internalType: 'address', name: 'pool', type: 'address' },
          { internalType: 'uint256', name: 'shares', type: 'uint256' },
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
 * Minimal UniswapV3Vault ABI for reading vault state
 */
const VAULT_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'positionManager',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tokenId',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'pool',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tickLower',
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tickUpper',
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Minimal NFPM ABI for reading position liquidity (via vault.positionManager)
 */
const NFPM_POSITIONS_ABI = [
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'positions',
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// =============================================================================
// Vault Pre-flight Validation
// =============================================================================

/**
 * Validate vault position state before close order execution.
 * Checks ERC-20 share balance > 0 and allowance to the closer contract.
 * Also reads vault's underlying NFPM position data for withdraw computation.
 *
 * @param shares - Shares from on-chain order (0 = close all)
 */
export async function validateVaultPosition(
  chainId: SupportedChainId,
  vaultAddress: `0x${string}`,
  ownerAddress: `0x${string}`,
  contractAddress: `0x${string}`,
  shares: bigint
): Promise<VaultPreflightValidation> {
  const client = getPublicClient(chainId);

  // Read vault ERC-20 state and underlying position data in parallel
  const [sharesBalance, totalSupply, allowance, positionManager, vaultTokenId, tickLower, tickUpper] = await Promise.all([
    client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'balanceOf', args: [ownerAddress] }),
    client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'totalSupply' }),
    client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'allowance', args: [ownerAddress, contractAddress] }),
    client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'positionManager' }),
    client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'tokenId' }),
    client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'tickLower' }),
    client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'tickUpper' }),
  ]);

  // Determine shares to close (0 = all)
  const sharesToClose = shares === 0n ? sharesBalance : shares;

  // Check share balance
  if (sharesBalance === 0n) {
    return {
      isValid: false,
      reason: `Owner has zero vault shares. Vault: ${vaultAddress}, Owner: ${ownerAddress}`,
      owner: ownerAddress,
    };
  }

  if (sharesToClose > sharesBalance) {
    return {
      isValid: false,
      reason: `Insufficient shares. Required: ${sharesToClose}, Available: ${sharesBalance}`,
      owner: ownerAddress,
    };
  }

  // Check allowance
  const isApproved = allowance >= sharesToClose;
  if (!isApproved) {
    return {
      isValid: false,
      reason: `Insufficient allowance. Required: ${sharesToClose}, Allowance: ${allowance}`,
      owner: ownerAddress,
      isApproved: false,
    };
  }

  // Read the vault's NFPM position to get liquidity and token addresses
  const nfpmPosition = await client.readContract({
    address: positionManager,
    abi: NFPM_POSITIONS_ABI,
    functionName: 'positions',
    args: [vaultTokenId],
  });

  const vaultLiquidity = nfpmPosition[7]; // liquidity field
  const token0 = nfpmPosition[2];
  const token1 = nfpmPosition[3];

  return {
    isValid: true,
    owner: ownerAddress,
    isApproved: true,
    vaultData: {
      sharesBalance,
      sharesToClose,
      totalSupply,
      allowance,
      vaultLiquidity,
      tickLower,
      tickUpper,
      token0,
      token1,
    },
  };
}

// =============================================================================
// On-Chain Order Reading
// =============================================================================

/**
 * Read on-chain vault close order configuration.
 * Used to determine slippage, swap config, and shares at execution time.
 */
export async function getVaultOnChainOrder(
  chainId: SupportedChainId,
  contractAddress: `0x${string}`,
  vaultAddress: `0x${string}`,
  ownerAddress: `0x${string}`,
  triggerMode: number
): Promise<OnChainOrderConfig & { shares: bigint }> {
  const client = getPublicClient(chainId);

  const result = await client.readContract({
    address: contractAddress,
    abi: VAULT_POSITION_CLOSER_ABI,
    functionName: 'getOrder',
    args: [vaultAddress, ownerAddress, triggerMode],
  });

  return {
    slippageBps: Number(result.slippageBps),
    swapDirection: Number(result.swapDirection),
    swapSlippageBps: Number(result.swapSlippageBps),
    shares: result.shares,
  };
}

// =============================================================================
// Withdraw Min Computation
// =============================================================================

/**
 * Compute withdraw min amounts for a vault position.
 * Calculates the user's proportional liquidity from their share ratio,
 * then delegates to the shared computeWithdrawMinAmounts utility.
 */
export async function computeVaultWithdrawMinAmounts(
  chainId: SupportedChainId,
  poolAddress: `0x${string}`,
  vaultData: VaultPreflightData,
  slippageBps: number
): Promise<SimulationWithdrawParams> {
  // User's proportional liquidity = vaultLiquidity * sharesToClose / totalSupply
  const userLiquidity = (vaultData.vaultLiquidity * vaultData.sharesToClose) / vaultData.totalSupply;

  return computeWithdrawMinAmounts(
    chainId,
    poolAddress,
    userLiquidity,
    vaultData.tickLower,
    vaultData.tickUpper,
    slippageBps
  );
}

// =============================================================================
// Simulation
// =============================================================================

/**
 * Simulate vault executeOrder transaction to catch errors before broadcasting.
 */
export async function simulateVaultExecution(
  chainId: SupportedChainId,
  contractAddress: `0x${string}`,
  vaultAddress: `0x${string}`,
  ownerAddress: `0x${string}`,
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
      abi: VAULT_POSITION_CLOSER_ABI,
      functionName: 'executeOrder',
      args: [vaultAddress, ownerAddress, triggerMode, withdrawParams, swapParams, feeParams] as any,
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
 * Encode vault executeOrder calldata for signing.
 */
export function encodeVaultExecuteOrderCalldata(params: {
  vaultAddress: `0x${string}`;
  ownerAddress: `0x${string}`;
  triggerMode: number;
  withdrawParams: SimulationWithdrawParams;
  swapParams: SimulationSwapParams;
  feeParams: SimulationFeeParams;
}): `0x${string}` {
  return encodeFunctionData({
    abi: VAULT_POSITION_CLOSER_ABI,
    functionName: 'executeOrder',
    args: [
      params.vaultAddress,
      params.ownerAddress,
      params.triggerMode,
      params.withdrawParams,
      params.swapParams,
      params.feeParams,
    ],
  });
}
