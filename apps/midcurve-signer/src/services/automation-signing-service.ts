/**
 * Automation Signing Service
 *
 * Signs transactions for position automation on mainnet chains.
 * Unlike strategy signing (which uses SEMSEE), this service works with
 * real mainnet chains (Ethereum, Arbitrum, etc).
 *
 * This service ONLY signs executeClose transactions for the automation operator.
 * - registerClose and cancelClose are owner-only functions signed by user's EOA
 * - executeClose is operator-only and signed by the automation wallet
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
 * Swap params for executeClose with post-close swap via Paraswap
 */
export interface SwapParams {
  augustus: Address;
  swapCalldata: Hex;
  deadline: number;
  minAmountOut: string; // Minimum output amount (slippage protection)
}

/**
 * Input for signing an executeClose transaction
 *
 * Based on contract function:
 * executeClose(uint256 closeId, address feeRecipient, uint16 feeBps, SwapParams calldata swapParams)
 */
export interface SignExecuteCloseInput {
  userId: string;
  chainId: number;
  contractAddress: Address;
  closeId: number;
  feeRecipient: Address;
  feeBps: number;
  // Gas parameters from caller (signer does not access RPC)
  gasLimit: bigint;
  gasPrice: bigint;
  // Nonce is required - caller fetches from chain (signer is stateless)
  nonce: number;
  // Optional swap params for post-close swap via Paraswap
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
 * UniswapV3PositionCloser ABI (minimal - only executeClose needed)
 *
 * Only executeClose is signed by the automation wallet (operator).
 * registerClose and cancelClose are signed by user's EOA (owner).
 */
const POSITION_CLOSER_ABI = [
  {
    type: 'function',
    name: 'executeClose',
    inputs: [
      { name: 'closeId', type: 'uint256' },
      { name: 'feeRecipient', type: 'address' },
      { name: 'feeBps', type: 'uint16' },
      {
        name: 'swapParams',
        type: 'tuple',
        components: [
          { name: 'augustus', type: 'address' },
          { name: 'swapCalldata', type: 'bytes' },
          { name: 'deadline', type: 'uint256' },
          { name: 'minAmountOut', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
] as const;

// Empty swap params (no swap)
const EMPTY_SWAP_PARAMS = {
  augustus: '0x0000000000000000000000000000000000000000' as Address,
  swapCalldata: '0x' as Hex,
  deadline: 0n,
  minAmountOut: 0n,
} as const;

// =============================================================================
// Service
// =============================================================================

class AutomationSigningServiceImpl {
  private readonly logger = signerLogger.child({ service: 'AutomationSigningService' });

  /**
   * Sign an executeClose transaction
   *
   * @param input - Execution input
   * @returns Signed transaction
   */
  async signExecuteClose(input: SignExecuteCloseInput): Promise<SignTransactionResult> {
    const { userId, chainId, contractAddress, closeId, feeRecipient, feeBps, gasLimit, gasPrice, nonce, swapParams } = input;
    signerLog.methodEntry(this.logger, 'signExecuteClose', { userId, chainId, contractAddress, closeId, nonce, hasSwap: !!swapParams });

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
          augustus: swapParams.augustus,
          swapCalldata: swapParams.swapCalldata,
          deadline: BigInt(swapParams.deadline),
          minAmountOut: BigInt(swapParams.minAmountOut),
        }
      : EMPTY_SWAP_PARAMS;

    // 3. Encode function call
    const callData = encodeFunctionData({
      abi: POSITION_CLOSER_ABI,
      functionName: 'executeClose',
      args: [BigInt(closeId), feeRecipient, feeBps, swapParamsTuple],
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
      closeId,
      nonce: result.nonce,
      msg: 'executeClose transaction signed',
    });

    signerLog.methodExit(this.logger, 'signExecuteClose', { nonce: result.nonce });

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
