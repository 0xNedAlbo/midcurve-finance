/**
 * Automation Signing Service
 *
 * Signs transactions for position automation on mainnet chains.
 * Unlike strategy signing (which uses SEMSEE), this service works with
 * real mainnet chains (Ethereum, Arbitrum, etc).
 *
 * This service ONLY signs executeOrder transactions for the automation operator.
 * - registerOrder and cancelOrder are owner-only functions signed by user's EOA
 * - executeOrder is operator-only and signed by the automation wallet
 *
 * Security: This service has NO RPC access. Gas parameters (gasLimit, gasPrice)
 * must be provided by the caller (automation service).
 *
 * Note: Contract deployment is done by the user via their own EOA wallet.
 * Bytecode is served by the midcurve-automation service.
 */

import {
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
  type Hash,
} from 'viem';
import { signerLogger, signerLog } from '@/lib/logger';
import { automationWalletService } from './automation-wallet-service';
import { privateKeyToAccount } from 'viem/accounts';

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
 * Swap params for executeOrder with post-close swap via MidcurveSwapRouter
 */
export interface SwapParams {
  minAmountOut: string; // Minimum output amount (slippage protection)
  deadline: number;
  hops: HopParams[];
}

/**
 * Input for signing an executeOrder transaction
 *
 * Based on contract function:
 * executeOrder(uint256 nftId, TriggerMode triggerMode, address feeRecipient, uint16 feeBps, SwapParams calldata swapParams)
 */
export interface SignExecuteOrderInput {
  userId: string;
  chainId: number;
  contractAddress: Address;
  nftId: bigint;
  triggerMode: number; // 0=LOWER, 1=UPPER
  feeRecipient: Address;
  feeBps: number;
  // Gas parameters from caller (signer does not access RPC)
  gasLimit: bigint;
  gasPrice: bigint;
  // Nonce is required - caller fetches from chain (signer is stateless)
  nonce: number;
  // Optional swap params for post-close swap via MidcurveSwapRouter
  swapParams?: SwapParams;
}

/**
 * Signing error codes
 */
export type AutomationSigningErrorCode =
  | 'WALLET_NOT_FOUND'
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
 *
 * Only executeOrder is signed by the automation wallet (operator).
 * registerOrder and cancelOrder are signed by user's EOA (owner).
 */
const POSITION_CLOSER_ABI = [
  {
    type: 'function',
    name: 'executeOrder',
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'triggerMode', type: 'uint8' },
      { name: 'feeRecipient', type: 'address' },
      { name: 'feeBps', type: 'uint16' },
      {
        name: 'swapParams',
        type: 'tuple',
        components: [
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
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// Empty swap params (no swap)
const EMPTY_SWAP_PARAMS = {
  minAmountOut: 0n,
  deadline: 0n,
  hops: [],
} as const;

// =============================================================================
// Service
// =============================================================================

class AutomationSigningServiceImpl {
  private readonly logger = signerLogger.child({ service: 'AutomationSigningService' });

  /**
   * Sign an executeOrder transaction
   *
   * @param input - Execution input
   * @returns Signed transaction
   */
  async signExecuteOrder(input: SignExecuteOrderInput): Promise<SignTransactionResult> {
    const { userId, chainId, contractAddress, nftId, triggerMode, feeRecipient, feeBps, gasLimit, gasPrice, nonce, swapParams } = input;
    signerLog.methodEntry(this.logger, 'signExecuteOrder', { userId, chainId, contractAddress, nftId: nftId.toString(), triggerMode, nonce, hasSwap: !!swapParams });

    // 1. Get wallet
    const wallet = await automationWalletService.getWalletByUserId(userId);
    if (!wallet) {
      throw new AutomationSigningError(
        `No automation wallet found for user ${userId}`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    // 2. Build swap params tuple (use empty params if no swap)
    const swapParamsTuple = swapParams
      ? {
          minAmountOut: BigInt(swapParams.minAmountOut),
          deadline: BigInt(swapParams.deadline),
          hops: swapParams.hops.map((hop) => ({
            venueId: hop.venueId as `0x${string}`,
            tokenIn: hop.tokenIn,
            tokenOut: hop.tokenOut,
            venueData: hop.venueData,
          })),
        }
      : EMPTY_SWAP_PARAMS;

    // 3. Encode function call
    const callData = encodeFunctionData({
      abi: POSITION_CLOSER_ABI,
      functionName: 'executeOrder',
      args: [nftId, triggerMode, feeRecipient, feeBps, swapParamsTuple],
    });

    // 4. Sign and return (gas params and nonce provided by caller)
    const result = await this.signContractCall({
      walletId: wallet.id,
      walletAddress: wallet.walletAddress,
      chainId,
      contractAddress,
      callData,
      gasLimit,
      gasPrice,
      nonce,
    });

    this.logger.info({
      userId,
      chainId,
      contractAddress,
      nftId: nftId.toString(),
      triggerMode,
      nonce: result.nonce,
      msg: 'executeOrder transaction signed',
    });

    signerLog.methodExit(this.logger, 'signExecuteOrder', { nonce: result.nonce });

    return result;
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Sign a contract call transaction
   *
   * Gas parameters (gasLimit, gasPrice) and nonce must be provided by the caller.
   * This keeps the signer stateless and isolated from external RPC endpoints.
   * The caller is responsible for fetching the on-chain nonce.
   */
  private async signContractCall(params: {
    walletId: string;
    walletAddress: Address;
    chainId: number;
    contractAddress: Address;
    callData: Hex;
    gasLimit: bigint;
    gasPrice: bigint;
    nonce: number;
  }): Promise<SignTransactionResult> {
    const { walletId, walletAddress, chainId, contractAddress, callData, gasLimit, gasPrice, nonce } = params;

    // Build and sign transaction (nonce provided by caller)
    const tx = {
      to: contractAddress,
      data: callData,
      chainId,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    const signedTx = await this.signTransaction(walletId, tx);
    const txHash = keccak256(signedTx);

    // 3. Update last used
    await automationWalletService.updateLastUsed(walletId);

    return {
      signedTransaction: signedTx,
      txHash,
      nonce,
      from: walletAddress,
    };
  }

  /**
   * Sign a transaction with the wallet's private key
   */
  private async signTransaction(
    walletId: string,
    tx: {
      to?: Address;
      data: Hex;
      chainId: number;
      nonce: number;
      gas: bigint;
      gasPrice: bigint;
      type: 'legacy';
    }
  ): Promise<Hex> {
    // Get private key from wallet service
    const privateKey = await automationWalletService.getPrivateKey(walletId);

    // Create account from private key
    const account = privateKeyToAccount(privateKey);

    // Sign the transaction directly using viem's account.signTransaction
    const signature = await account.signTransaction({
      ...tx,
      to: tx.to ?? null,
    } as any);

    return signature;
  }
}

// Export singleton instance
export const automationSigningService = new AutomationSigningServiceImpl();
