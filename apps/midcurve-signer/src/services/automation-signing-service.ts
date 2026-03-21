/**
 * Automation Signing Service
 *
 * Signs transactions for position automation using a single operator key.
 * The operator key is managed by OperatorKeyService (persisted in Settings table).
 *
 * This service signs operator transactions for automation:
 * - executeOrder: triggered close orders on UniswapV3PositionCloser
 * - refuelOperator: gas recovery from MidcurveTreasury
 *
 * Security: This service has NO RPC access. Gas parameters (gasLimit, gasPrice)
 * must be provided by the caller (automation service).
 */

import {
  encodeFunctionData,
  keccak256,
  serializeTransaction,
  type Address,
  type Hex,
  type Hash,
} from 'viem';
import { signerLogger, signerLog } from '@/lib/logger';
import { OperatorKeyService } from './operator-key-service';

// =============================================================================
// Types
// =============================================================================

/**
 * Result from signing a transaction
 */
export interface SignTransactionResult {
  signedTransaction: Hex;
  txHash: Hash;
  nonce: number;
  from: Address;
}

/**
 * A single hop in the swap route through MidcurveSwapRouter
 */
export interface HopParams {
  venueId: string;      // bytes32 hex
  tokenIn: Address;
  tokenOut: Address;
  venueData: Hex;
}

/**
 * WithdrawParams for executeOrder (off-chain computed withdrawal mins)
 */
export interface WithdrawParams {
  amount0Min: string;
  amount1Min: string;
}

/**
 * SwapParams for executeOrder with two-phase swap via MidcurveSwapRouter
 */
export interface SwapParams {
  guaranteedAmountIn: string;
  minAmountOut: string;
  deadline: number;
  hops: HopParams[];
}

/**
 * FeeParams for executeOrder
 */
export interface FeeParams {
  feeRecipient: Address;
  feeBps: number;
}

/**
 * Input for signing an executeOrder transaction
 *
 * Based on contract function:
 * executeOrder(uint256 nftId, TriggerMode triggerMode, WithdrawParams, SwapParams, FeeParams)
 */
export interface SignExecuteOrderInput {
  userId: string;
  chainId: number;
  contractAddress: Address;
  nftId: bigint;
  triggerMode: number; // 0=LOWER, 1=UPPER
  // Gas parameters from caller (signer does not access RPC)
  gasLimit: bigint;
  gasPrice: bigint;
  // Nonce is required - caller fetches from chain (signer is stateless)
  nonce: number;
  // Structured execution params
  withdrawParams: WithdrawParams;
  swapParams: SwapParams;
  feeParams: FeeParams;
}

/**
 * Input for signing a refuelOperator transaction on MidcurveTreasury
 *
 * Based on contract function:
 * refuelOperator(address tokenIn, uint256 amountIn, uint256 minEthOut, uint256 deadline, Hop[] hops)
 */
export interface SignRefuelOperatorInput {
  chainId: number;
  treasuryAddress: Address;
  tokenIn: Address;
  amountIn: bigint;
  minEthOut: bigint;
  deadline: number;
  hops: HopParams[];    // empty array for WETH direct path
  gasLimit: bigint;
  gasPrice: bigint;
  nonce: number;
}

/**
 * Signing error codes
 */
export type AutomationSigningErrorCode =
  | 'OPERATOR_NOT_INITIALIZED'
  | 'SIGNING_FAILED'
  | 'INTERNAL_ERROR';

/**
 * Service error
 */
export class AutomationSigningError extends Error {
  constructor(
    message: string,
    public readonly code: AutomationSigningErrorCode,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AutomationSigningError';
  }
}

// =============================================================================
// Contract ABIs
// =============================================================================

/**
 * UniswapV3PositionCloser ABI (minimal - only executeOrder needed)
 */
const POSITION_CLOSER_ABI = [
  {
    type: 'function',
    name: 'executeOrder',
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'triggerMode', type: 'uint8' },
      {
        name: 'withdrawParams',
        type: 'tuple',
        components: [
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
        ],
      },
      {
        name: 'swapParams',
        type: 'tuple',
        components: [
          { name: 'guaranteedAmountIn', type: 'uint256' },
          { name: 'minAmountOut', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          {
            name: 'hops',
            type: 'tuple[]',
            components: [
              { name: 'venueId', type: 'bytes32' },
              { name: 'tokenIn', type: 'address' },
              { name: 'tokenOut', type: 'address' },
              { name: 'venueData', type: 'bytes' },
            ],
          },
        ],
      },
      {
        name: 'feeParams',
        type: 'tuple',
        components: [
          { name: 'feeRecipient', type: 'address' },
          { name: 'feeBps', type: 'uint16' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * MidcurveTreasury ABI (minimal - only refuelOperator needed)
 */
const TREASURY_ABI = [
  {
    type: 'function',
    name: 'refuelOperator',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      {
        name: 'hops',
        type: 'tuple[]',
        components: [
          { name: 'venueId', type: 'bytes32' },
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'venueData', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// =============================================================================
// Service
// =============================================================================

class AutomationSigningServiceImpl {
  private readonly logger = signerLogger.child({ service: 'AutomationSigningService' });

  /**
   * Sign an executeOrder transaction using the singleton operator key.
   */
  async signExecuteOrder(input: SignExecuteOrderInput): Promise<SignTransactionResult> {
    const { userId, chainId, contractAddress, nftId, triggerMode, gasLimit, gasPrice, nonce, withdrawParams, swapParams, feeParams } = input;
    signerLog.methodEntry(this.logger, 'signExecuteOrder', { userId, chainId, contractAddress, nftId: nftId.toString(), triggerMode, nonce, hasSwap: swapParams.hops.length > 0 });

    const operatorKeyService = OperatorKeyService.getInstance();
    const operatorAddress = await operatorKeyService.getOperatorAddress();

    // Build param tuples
    const withdrawParamsTuple = {
      amount0Min: BigInt(withdrawParams.amount0Min),
      amount1Min: BigInt(withdrawParams.amount1Min),
    };

    const swapParamsTuple = {
      guaranteedAmountIn: BigInt(swapParams.guaranteedAmountIn),
      minAmountOut: BigInt(swapParams.minAmountOut),
      deadline: BigInt(swapParams.deadline),
      hops: swapParams.hops.map((hop) => ({
        venueId: hop.venueId as `0x${string}`,
        tokenIn: hop.tokenIn,
        tokenOut: hop.tokenOut,
        venueData: hop.venueData,
      })),
    };

    const feeParamsTuple = {
      feeRecipient: feeParams.feeRecipient,
      feeBps: feeParams.feeBps,
    };

    // Encode function call
    const callData = encodeFunctionData({
      abi: POSITION_CLOSER_ABI,
      functionName: 'executeOrder',
      args: [nftId, triggerMode, withdrawParamsTuple, swapParamsTuple, feeParamsTuple],
    });

    // Build unsigned transaction
    const tx = {
      to: contractAddress,
      data: callData,
      chainId,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    // Serialize unsigned transaction to get the hash to sign
    const unsignedTxHash = keccak256(serializeTransaction(tx));

    // Sign with operator key
    const signature = await operatorKeyService.signTransaction(unsignedTxHash);

    // Serialize signed transaction
    const signedTransaction = serializeTransaction(tx, {
      r: signature.r,
      s: signature.s,
      v: BigInt(signature.v - 27 + chainId * 2 + 35), // EIP-155: v = recovery_id + chainId * 2 + 35
    });

    const txHash = keccak256(signedTransaction);

    this.logger.info({
      userId,
      chainId,
      contractAddress,
      nftId: nftId.toString(),
      triggerMode,
      nonce,
      from: operatorAddress,
      msg: 'executeOrder transaction signed with operator key',
    });

    signerLog.methodExit(this.logger, 'signExecuteOrder', { nonce });

    return {
      signedTransaction,
      txHash,
      nonce,
      from: operatorAddress,
    };
  }

  /**
   * Sign a refuelOperator transaction on MidcurveTreasury.
   */
  async signRefuelOperator(input: SignRefuelOperatorInput): Promise<SignTransactionResult> {
    const { chainId, treasuryAddress, tokenIn, amountIn, minEthOut, deadline, hops, gasLimit, gasPrice, nonce } = input;
    signerLog.methodEntry(this.logger, 'signRefuelOperator', { chainId, treasuryAddress, tokenIn, amountIn: amountIn.toString(), nonce });

    const operatorKeyService = OperatorKeyService.getInstance();
    const operatorAddress = await operatorKeyService.getOperatorAddress();

    const hopsTuple = hops.map((hop) => ({
      venueId: hop.venueId as `0x${string}`,
      tokenIn: hop.tokenIn,
      tokenOut: hop.tokenOut,
      venueData: hop.venueData,
    }));

    const callData = encodeFunctionData({
      abi: TREASURY_ABI,
      functionName: 'refuelOperator',
      args: [tokenIn, amountIn, minEthOut, BigInt(deadline), hopsTuple],
    });

    const tx = {
      to: treasuryAddress,
      data: callData,
      chainId,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    const unsignedTxHash = keccak256(serializeTransaction(tx));
    const signature = await operatorKeyService.signTransaction(unsignedTxHash);

    const signedTransaction = serializeTransaction(tx, {
      r: signature.r,
      s: signature.s,
      v: BigInt(signature.v - 27 + chainId * 2 + 35),
    });

    const txHash = keccak256(signedTransaction);

    this.logger.info({
      chainId,
      treasuryAddress,
      tokenIn,
      amountIn: amountIn.toString(),
      nonce,
      from: operatorAddress,
      msg: 'refuelOperator transaction signed with operator key',
    });

    signerLog.methodExit(this.logger, 'signRefuelOperator', { nonce });

    return { signedTransaction, txHash, nonce, from: operatorAddress };
  }
}

// Export singleton instance
export const automationSigningService = new AutomationSigningServiceImpl();
