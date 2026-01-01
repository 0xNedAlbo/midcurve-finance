/**
 * Automation Signing Service
 *
 * Signs transactions for position automation on mainnet chains.
 * Unlike strategy signing (which uses SEMSEE), this service works with
 * real mainnet chains (Ethereum, Arbitrum, etc).
 *
 * Endpoints supported:
 * - signDeployCloser: Deploy UniswapV3PositionCloser contract
 * - signRegisterClose: Register a close order on the contract
 * - signExecuteClose: Execute a triggered close order
 * - signCancelClose: Cancel a pending close order
 */

import {
  createPublicClient,
  http,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  getContractAddress,
  type Address,
  type Hex,
  type Hash,
} from 'viem';
import {
  mainnet,
  arbitrum,
  base,
  bsc,
  polygon,
  optimism,
  type Chain,
} from 'viem/chains';
import { signerLogger, signerLog } from '@/lib/logger';
import { automationWalletService } from './automation-wallet-service';
import { privateKeyToAccount } from 'viem/accounts';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported mainnet chain IDs
 */
export enum SupportedChainId {
  ETHEREUM = 1,
  ARBITRUM = 42161,
  BASE = 8453,
  BSC = 56,
  POLYGON = 137,
  OPTIMISM = 10,
}

/**
 * Chain configuration
 */
interface ChainConfig {
  chainId: number;
  viemChain: Chain;
  rpcEnvVar: string;
}

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
 * Result from signing a deployment transaction
 */
export interface SignDeployResult extends SignTransactionResult {
  predictedAddress: Address;
}

/**
 * Input for signing a closer contract deployment
 */
export interface SignDeployCloserInput {
  userId: string;
  chainId: number;
  nfpmAddress: Address; // NonFungiblePositionManager address on this chain
}

/**
 * Input for signing a registerClose transaction
 *
 * Based on contract function:
 * registerClose(
 *   uint256 nftId,
 *   uint160 sqrtPriceX96Lower,
 *   uint160 sqrtPriceX96Upper,
 *   address payoutAddress,
 *   uint256 validUntil,
 *   uint16 slippageBps
 * )
 */
export interface SignRegisterCloseInput {
  userId: string;
  chainId: number;
  contractAddress: Address;
  nftId: bigint;
  sqrtPriceX96Lower: bigint;
  sqrtPriceX96Upper: bigint;
  payoutAddress: Address;
  validUntil: bigint; // Unix timestamp
  slippageBps: number;
}

/**
 * Input for signing an executeClose transaction
 *
 * Based on contract function:
 * executeClose(uint256 closeId, address feeRecipient, uint16 feeBps)
 */
export interface SignExecuteCloseInput {
  userId: string;
  chainId: number;
  contractAddress: Address;
  closeId: number;
  feeRecipient: Address;
  feeBps: number;
}

/**
 * Input for signing a cancelClose transaction
 *
 * Based on contract function:
 * cancelClose(uint256 closeId)
 */
export interface SignCancelCloseInput {
  userId: string;
  chainId: number;
  contractAddress: Address;
  closeId: number;
}

/**
 * Signing error codes
 */
export type AutomationSigningErrorCode =
  | 'WALLET_NOT_FOUND'
  | 'CHAIN_NOT_SUPPORTED'
  | 'RPC_NOT_CONFIGURED'
  | 'SIGNING_FAILED'
  | 'INSUFFICIENT_BALANCE'
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
 * UniswapV3PositionCloser ABI (minimal - only functions we need)
 *
 * Constructor: constructor(address nfpm)
 * - nfpm: NonFungiblePositionManager address
 */
const POSITION_CLOSER_ABI = [
  // Constructor
  {
    type: 'constructor',
    inputs: [{ name: 'nfpm', type: 'address' }],
  },
  // registerClose
  {
    type: 'function',
    name: 'registerClose',
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'sqrtPriceX96Lower', type: 'uint160' },
      { name: 'sqrtPriceX96Upper', type: 'uint160' },
      { name: 'payoutAddress', type: 'address' },
      { name: 'validUntil', type: 'uint256' },
      { name: 'slippageBps', type: 'uint16' },
    ],
    outputs: [{ name: 'closeId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  // executeClose
  {
    type: 'function',
    name: 'executeClose',
    inputs: [
      { name: 'closeId', type: 'uint256' },
      { name: 'feeRecipient', type: 'address' },
      { name: 'feeBps', type: 'uint16' },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  // cancelClose
  {
    type: 'function',
    name: 'cancelClose',
    inputs: [{ name: 'closeId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * UniswapV3PositionCloser bytecode placeholder
 *
 * This should be replaced with the actual compiled bytecode.
 * For now, we'll throw an error if deployment is attempted.
 */
const POSITION_CLOSER_BYTECODE = process.env.POSITION_CLOSER_BYTECODE as Hex | undefined;

// =============================================================================
// Chain Configuration
// =============================================================================

const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [SupportedChainId.ETHEREUM]: {
    chainId: SupportedChainId.ETHEREUM,
    viemChain: mainnet,
    rpcEnvVar: 'RPC_URL_ETHEREUM',
  },
  [SupportedChainId.ARBITRUM]: {
    chainId: SupportedChainId.ARBITRUM,
    viemChain: arbitrum,
    rpcEnvVar: 'RPC_URL_ARBITRUM',
  },
  [SupportedChainId.BASE]: {
    chainId: SupportedChainId.BASE,
    viemChain: base,
    rpcEnvVar: 'RPC_URL_BASE',
  },
  [SupportedChainId.BSC]: {
    chainId: SupportedChainId.BSC,
    viemChain: bsc,
    rpcEnvVar: 'RPC_URL_BSC',
  },
  [SupportedChainId.POLYGON]: {
    chainId: SupportedChainId.POLYGON,
    viemChain: polygon,
    rpcEnvVar: 'RPC_URL_POLYGON',
  },
  [SupportedChainId.OPTIMISM]: {
    chainId: SupportedChainId.OPTIMISM,
    viemChain: optimism,
    rpcEnvVar: 'RPC_URL_OPTIMISM',
  },
};

// =============================================================================
// Service
// =============================================================================

class AutomationSigningServiceImpl {
  private readonly logger = signerLogger.child({ service: 'AutomationSigningService' });

  /**
   * Get chain configuration
   */
  private getChainConfig(chainId: number): ChainConfig {
    const config = CHAIN_CONFIGS[chainId];
    if (!config) {
      throw new AutomationSigningError(
        `Chain ${chainId} is not supported. Supported chains: ${Object.keys(CHAIN_CONFIGS).join(', ')}`,
        'CHAIN_NOT_SUPPORTED',
        400
      );
    }
    return config;
  }

  /**
   * Create a public client for a chain
   */
  private createPublicClient(chainId: number) {
    const config = this.getChainConfig(chainId);
    const rpcUrl = process.env[config.rpcEnvVar];

    if (!rpcUrl) {
      throw new AutomationSigningError(
        `RPC URL not configured for chain ${chainId}. Set ${config.rpcEnvVar} environment variable.`,
        'RPC_NOT_CONFIGURED',
        500
      );
    }

    return createPublicClient({
      chain: config.viemChain,
      transport: http(rpcUrl),
    });
  }

  /**
   * Sign a UniswapV3PositionCloser deployment transaction
   *
   * @param input - Deployment input (userId, chainId, nfpmAddress)
   * @returns Signed transaction and predicted contract address
   */
  async signDeployCloser(input: SignDeployCloserInput): Promise<SignDeployResult> {
    const { userId, chainId, nfpmAddress } = input;
    signerLog.methodEntry(this.logger, 'signDeployCloser', { userId, chainId, nfpmAddress });

    // Validate bytecode is available
    if (!POSITION_CLOSER_BYTECODE) {
      throw new AutomationSigningError(
        'POSITION_CLOSER_BYTECODE environment variable not set. Contract deployment requires compiled bytecode.',
        'INTERNAL_ERROR',
        500
      );
    }

    // 1. Get or create automation wallet
    const wallet = await automationWalletService.getOrCreateWallet({ userId });

    this.logger.info({
      userId,
      chainId,
      walletAddress: wallet.walletAddress,
      msg: 'Using automation wallet for deployment',
    });

    // 2. Get chain public client
    const publicClient = this.createPublicClient(chainId);

    // 3. Check balance
    const balance = await publicClient.getBalance({ address: wallet.walletAddress });
    if (balance === 0n) {
      throw new AutomationSigningError(
        `Wallet ${wallet.walletAddress} has zero balance on chain ${chainId}. Fund the wallet before deployment.`,
        'INSUFFICIENT_BALANCE',
        400,
        { walletAddress: wallet.walletAddress, chainId }
      );
    }

    // 4. Encode deployment data
    const deployData = encodeDeployData({
      abi: POSITION_CLOSER_ABI,
      bytecode: POSITION_CLOSER_BYTECODE,
      args: [nfpmAddress],
    });

    // 5. Get nonce from our tracking
    const nonce = await automationWalletService.getAndIncrementNonce(wallet.id, chainId);

    // 6. Estimate gas
    const gasPrice = await publicClient.getGasPrice();
    let gasLimit: bigint;
    try {
      const gasEstimate = await publicClient.estimateGas({
        account: wallet.walletAddress,
        data: deployData,
      });
      gasLimit = (gasEstimate * 120n) / 100n; // 20% buffer
    } catch (error) {
      this.logger.warn({
        userId,
        chainId,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Gas estimation failed, using fallback gas limit of 2M',
      });
      gasLimit = 2_000_000n;
    }

    // 7. Build and sign transaction
    const tx = {
      to: undefined, // Contract deployment
      data: deployData,
      chainId,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    const signedTx = await this.signTransaction(wallet.id, tx);
    const txHash = keccak256(signedTx);

    // 8. Calculate predicted address
    const predictedAddress = getContractAddress({
      from: wallet.walletAddress,
      nonce: BigInt(nonce),
    });

    // 9. Update last used
    await automationWalletService.updateLastUsed(wallet.id);

    this.logger.info({
      userId,
      chainId,
      predictedAddress,
      nonce,
      msg: 'Deployment transaction signed',
    });

    signerLog.methodExit(this.logger, 'signDeployCloser', { predictedAddress });

    return {
      signedTransaction: signedTx,
      txHash,
      nonce,
      from: wallet.walletAddress,
      predictedAddress,
    };
  }

  /**
   * Sign a registerClose transaction
   *
   * @param input - Registration input
   * @returns Signed transaction
   */
  async signRegisterClose(input: SignRegisterCloseInput): Promise<SignTransactionResult> {
    const { userId, chainId, contractAddress, nftId, sqrtPriceX96Lower, sqrtPriceX96Upper, payoutAddress, validUntil, slippageBps } = input;
    signerLog.methodEntry(this.logger, 'signRegisterClose', { userId, chainId, contractAddress, nftId: nftId.toString() });

    // 1. Get wallet
    const wallet = await automationWalletService.getWalletByUserId(userId);
    if (!wallet) {
      throw new AutomationSigningError(
        `No automation wallet found for user ${userId}`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    // 2. Encode function call
    const callData = encodeFunctionData({
      abi: POSITION_CLOSER_ABI,
      functionName: 'registerClose',
      args: [nftId, sqrtPriceX96Lower, sqrtPriceX96Upper, payoutAddress, validUntil, slippageBps],
    });

    // 3. Sign and return
    const result = await this.signContractCall({
      walletId: wallet.id,
      walletAddress: wallet.walletAddress,
      chainId,
      contractAddress,
      callData,
    });

    this.logger.info({
      userId,
      chainId,
      contractAddress,
      nftId: nftId.toString(),
      nonce: result.nonce,
      msg: 'registerClose transaction signed',
    });

    signerLog.methodExit(this.logger, 'signRegisterClose', { nonce: result.nonce });

    return result;
  }

  /**
   * Sign an executeClose transaction
   *
   * @param input - Execution input
   * @returns Signed transaction
   */
  async signExecuteClose(input: SignExecuteCloseInput): Promise<SignTransactionResult> {
    const { userId, chainId, contractAddress, closeId, feeRecipient, feeBps } = input;
    signerLog.methodEntry(this.logger, 'signExecuteClose', { userId, chainId, contractAddress, closeId });

    // 1. Get wallet
    const wallet = await automationWalletService.getWalletByUserId(userId);
    if (!wallet) {
      throw new AutomationSigningError(
        `No automation wallet found for user ${userId}`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    // 2. Encode function call
    const callData = encodeFunctionData({
      abi: POSITION_CLOSER_ABI,
      functionName: 'executeClose',
      args: [BigInt(closeId), feeRecipient, feeBps],
    });

    // 3. Sign and return
    const result = await this.signContractCall({
      walletId: wallet.id,
      walletAddress: wallet.walletAddress,
      chainId,
      contractAddress,
      callData,
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

  /**
   * Sign a cancelClose transaction
   *
   * @param input - Cancellation input
   * @returns Signed transaction
   */
  async signCancelClose(input: SignCancelCloseInput): Promise<SignTransactionResult> {
    const { userId, chainId, contractAddress, closeId } = input;
    signerLog.methodEntry(this.logger, 'signCancelClose', { userId, chainId, contractAddress, closeId });

    // 1. Get wallet
    const wallet = await automationWalletService.getWalletByUserId(userId);
    if (!wallet) {
      throw new AutomationSigningError(
        `No automation wallet found for user ${userId}`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    // 2. Encode function call
    const callData = encodeFunctionData({
      abi: POSITION_CLOSER_ABI,
      functionName: 'cancelClose',
      args: [BigInt(closeId)],
    });

    // 3. Sign and return
    const result = await this.signContractCall({
      walletId: wallet.id,
      walletAddress: wallet.walletAddress,
      chainId,
      contractAddress,
      callData,
    });

    this.logger.info({
      userId,
      chainId,
      contractAddress,
      closeId,
      nonce: result.nonce,
      msg: 'cancelClose transaction signed',
    });

    signerLog.methodExit(this.logger, 'signCancelClose', { nonce: result.nonce });

    return result;
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Sign a contract call transaction
   */
  private async signContractCall(params: {
    walletId: string;
    walletAddress: Address;
    chainId: number;
    contractAddress: Address;
    callData: Hex;
  }): Promise<SignTransactionResult> {
    const { walletId, walletAddress, chainId, contractAddress, callData } = params;

    // 1. Get chain public client
    const publicClient = this.createPublicClient(chainId);

    // 2. Get nonce
    const nonce = await automationWalletService.getAndIncrementNonce(walletId, chainId);

    // 3. Estimate gas
    const gasPrice = await publicClient.getGasPrice();
    let gasLimit: bigint;
    try {
      const gasEstimate = await publicClient.estimateGas({
        account: walletAddress,
        to: contractAddress,
        data: callData,
      });
      gasLimit = (gasEstimate * 120n) / 100n; // 20% buffer
    } catch (error) {
      this.logger.warn({
        walletId,
        chainId,
        contractAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Gas estimation failed, using fallback gas limit of 500k',
      });
      gasLimit = 500_000n;
    }

    // 4. Build and sign transaction
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

    // 5. Update last used
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
