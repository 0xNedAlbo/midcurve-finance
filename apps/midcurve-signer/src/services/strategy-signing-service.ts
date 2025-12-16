/**
 * Strategy Signing Service
 *
 * Provides signing functionality for strategy-related transactions.
 * This service signs transactions but does NOT broadcast them.
 * Broadcasting is handled by the midcurve-evm Core orchestrator.
 *
 * Endpoints:
 * - /api/sign/strategy/deploy - Sign deployment transaction
 * - /api/sign/strategy/step - Sign step() transaction
 * - /api/sign/strategy/submit-effect-result - Sign submitEffectResult() transaction
 */

import {
  createPublicClient,
  http,
  encodeDeployData,
  encodeFunctionData,
  serializeTransaction,
  keccak256,
  type Address,
  type Hex,
  type Abi,
  type Hash,
  getContractAddress,
} from 'viem';
import { prisma } from '../lib/prisma';
import { getSigner } from '../lib/kms';
import { signerLogger, signerLog } from '../lib/logger';

// =============================================================================
// Types
// =============================================================================

/**
 * Result from signing a deployment transaction
 */
export interface SignDeployResult {
  signedTransaction: Hex;
  predictedAddress: Address;
  nonce: number;
  txHash: Hash;
}

/**
 * Result from signing a step or submitEffectResult transaction
 */
export interface SignContractCallResult {
  signedTransaction: Hex;
  nonce: number;
  txHash: Hash;
}

/**
 * Input for signing a deployment transaction
 */
export interface SignDeployInput {
  strategyId: string;
  chainId: number;
  ownerAddress: Address;
}

/**
 * Input for signing a step() transaction
 */
export interface SignStepInput {
  strategyId: string;
  stepInput: Hex; // ABI-encoded step input
}

/**
 * Input for signing a submitEffectResult() transaction
 */
export interface SignSubmitEffectResultInput {
  strategyId: string;
  epoch: string; // uint64 as string
  idempotencyKey: Hex; // bytes32
  ok: boolean;
  data: Hex; // bytes
}

/**
 * Constructor parameter definition from manifest
 */
interface ConstructorParam {
  name: string;
  type: string;
  source: 'user-wallet' | 'automation-wallet' | 'user-input' | 'derived';
  label?: string;
  description?: string;
  required?: boolean;
  default?: string;
}

/**
 * Service error codes
 */
export type SigningErrorCode =
  | 'STRATEGY_NOT_FOUND'
  | 'MANIFEST_NOT_FOUND'
  | 'WALLET_NOT_FOUND'
  | 'INVALID_STATE'
  | 'SIGNING_FAILED'
  | 'INTERNAL_ERROR';

/**
 * Service error
 */
export class StrategySigningError extends Error {
  constructor(
    message: string,
    public readonly code: SigningErrorCode,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'StrategySigningError';
  }
}

// =============================================================================
// SEMSEE Chain Configuration
// =============================================================================

/**
 * Get SEMSEE chain configuration
 */
function getSemseeChain(chainId: number) {
  return {
    id: chainId,
    name: 'SEMSEE',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: [process.env.SEMSEE_RPC_URL || 'http://localhost:8545'],
      },
    },
  } as const;
}

/**
 * Create a public client for SEMSEE
 */
function createSemseePublicClient(chainId: number) {
  const rpcUrl = process.env.SEMSEE_RPC_URL || 'http://localhost:8545';
  return createPublicClient({
    chain: getSemseeChain(chainId),
    transport: http(rpcUrl),
  });
}

// =============================================================================
// Service
// =============================================================================

class StrategySigningService {
  private readonly logger = signerLogger.child({ service: 'StrategySigningService' });

  /**
   * Sign a deployment transaction
   *
   * @param input - Deployment signing input
   * @returns Signed transaction and predicted contract address
   * @throws StrategySigningError if strategy not found, invalid state, or signing fails
   */
  async signDeployment(input: SignDeployInput): Promise<SignDeployResult> {
    const { strategyId, chainId, ownerAddress } = input;
    signerLog.methodEntry(this.logger, 'signDeployment', { strategyId, chainId });

    // 1. Fetch strategy with manifest and automation wallet
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      include: {
        manifest: true,
        automationWallets: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!strategy) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' not found`,
        'STRATEGY_NOT_FOUND',
        404
      );
    }

    // 2. Validate strategy state
    if (strategy.status !== 'deploying') {
      throw new StrategySigningError(
        `Strategy is in '${strategy.status}' state, expected 'deploying'`,
        'INVALID_STATE',
        400
      );
    }

    // 3. Validate manifest exists
    if (!strategy.manifest) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' has no manifest`,
        'MANIFEST_NOT_FOUND',
        404
      );
    }

    // 4. Validate automation wallet exists
    const wallet = strategy.automationWallets[0];
    if (!wallet) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' has no automation wallet`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    const walletConfig = wallet.config as { walletAddress: Address; kmsKeyId: string };
    const manifest = strategy.manifest;

    this.logger.info({
      strategyId,
      manifestSlug: manifest.slug,
      chainId,
      walletAddress: walletConfig.walletAddress,
      msg: 'Signing deployment transaction',
    });

    // 5. Build constructor arguments
    const constructorParams = manifest.constructorParams as unknown as ConstructorParam[];
    const constructorValues = ((strategy.config as Record<string, unknown>)?._constructorValues ?? {}) as Record<string, string>;

    const constructorArgs = this.buildConstructorArgs(
      constructorParams,
      constructorValues,
      ownerAddress,
      walletConfig.walletAddress
    );

    // 6. Prepare and sign deployment transaction
    const publicClient = createSemseePublicClient(chainId);

    // Encode deployment data
    const deployData = encodeDeployData({
      abi: manifest.abi as unknown as Abi,
      bytecode: manifest.bytecode as Hex,
      args: constructorArgs,
    });

    // Get gas price and nonce
    const gasPrice = await publicClient.getGasPrice();
    const nonce = await publicClient.getTransactionCount({
      address: walletConfig.walletAddress,
    });

    // Estimate gas
    const gasEstimate = await publicClient.estimateGas({
      account: walletConfig.walletAddress,
      data: deployData,
    });
    const gasLimit = (gasEstimate * 120n) / 100n; // 20% buffer

    // Build transaction
    const tx = {
      to: undefined, // Contract deployment
      data: deployData,
      chainId,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    // Sign transaction
    const signedTx = await this.signTransaction(tx, walletConfig.kmsKeyId, chainId);

    // Calculate predicted contract address
    const predictedAddress = getContractAddress({
      from: walletConfig.walletAddress,
      nonce: BigInt(nonce),
    });

    const txHash = keccak256(signedTx);

    this.logger.info({
      strategyId,
      predictedAddress,
      nonce,
      msg: 'Deployment transaction signed',
    });

    signerLog.methodExit(this.logger, 'signDeployment', { predictedAddress });

    return {
      signedTransaction: signedTx,
      predictedAddress,
      nonce,
      txHash,
    };
  }

  /**
   * Sign a step() transaction
   *
   * @param input - Step signing input
   * @returns Signed transaction
   * @throws StrategySigningError if strategy not found, invalid state, or signing fails
   */
  async signStep(input: SignStepInput): Promise<SignContractCallResult> {
    const { strategyId, stepInput } = input;
    signerLog.methodEntry(this.logger, 'signStep', { strategyId });

    // 1. Fetch strategy with manifest and wallet
    const { strategy, walletConfig, manifest } = await this.fetchStrategyWithWallet(
      strategyId,
      'active' // step() only allowed when active
    );

    if (!strategy.contractAddress || !strategy.chainId) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' is not deployed`,
        'INVALID_STATE',
        400
      );
    }

    const publicClient = createSemseePublicClient(strategy.chainId);

    // Encode step() call
    const callData = encodeFunctionData({
      abi: manifest.abi as unknown as Abi,
      functionName: 'step',
      args: [stepInput],
    });

    // Get gas price and nonce
    const gasPrice = await publicClient.getGasPrice();
    const nonce = await publicClient.getTransactionCount({
      address: walletConfig.walletAddress,
    });

    // Estimate gas
    const gasEstimate = await publicClient.estimateGas({
      account: walletConfig.walletAddress,
      to: strategy.contractAddress as Address,
      data: callData,
    });
    const gasLimit = (gasEstimate * 120n) / 100n;

    // Build transaction
    const tx = {
      to: strategy.contractAddress as Address,
      data: callData,
      chainId: strategy.chainId,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    // Sign transaction
    const signedTx = await this.signTransaction(tx, walletConfig.kmsKeyId, strategy.chainId);
    const txHash = keccak256(signedTx);

    this.logger.info({
      strategyId,
      contractAddress: strategy.contractAddress,
      nonce,
      msg: 'step() transaction signed',
    });

    signerLog.methodExit(this.logger, 'signStep', { nonce });

    return {
      signedTransaction: signedTx,
      nonce,
      txHash,
    };
  }

  /**
   * Sign a submitEffectResult() transaction
   *
   * @param input - Submit effect result signing input
   * @returns Signed transaction
   * @throws StrategySigningError if strategy not found, invalid state, or signing fails
   */
  async signSubmitEffectResult(input: SignSubmitEffectResultInput): Promise<SignContractCallResult> {
    const { strategyId, epoch, idempotencyKey, ok, data } = input;
    signerLog.methodEntry(this.logger, 'signSubmitEffectResult', { strategyId, epoch });

    // 1. Fetch strategy with manifest and wallet
    const { strategy, walletConfig, manifest } = await this.fetchStrategyWithWallet(
      strategyId,
      'active' // submitEffectResult() only allowed when active
    );

    if (!strategy.contractAddress || !strategy.chainId) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' is not deployed`,
        'INVALID_STATE',
        400
      );
    }

    const publicClient = createSemseePublicClient(strategy.chainId);

    // Encode submitEffectResult() call
    const callData = encodeFunctionData({
      abi: manifest.abi as unknown as Abi,
      functionName: 'submitEffectResult',
      args: [BigInt(epoch), idempotencyKey, ok, data],
    });

    // Get gas price and nonce
    const gasPrice = await publicClient.getGasPrice();
    const nonce = await publicClient.getTransactionCount({
      address: walletConfig.walletAddress,
    });

    // Estimate gas
    const gasEstimate = await publicClient.estimateGas({
      account: walletConfig.walletAddress,
      to: strategy.contractAddress as Address,
      data: callData,
    });
    const gasLimit = (gasEstimate * 120n) / 100n;

    // Build transaction
    const tx = {
      to: strategy.contractAddress as Address,
      data: callData,
      chainId: strategy.chainId,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    // Sign transaction
    const signedTx = await this.signTransaction(tx, walletConfig.kmsKeyId, strategy.chainId);
    const txHash = keccak256(signedTx);

    this.logger.info({
      strategyId,
      contractAddress: strategy.contractAddress,
      epoch,
      nonce,
      msg: 'submitEffectResult() transaction signed',
    });

    signerLog.methodExit(this.logger, 'signSubmitEffectResult', { nonce });

    return {
      signedTransaction: signedTx,
      nonce,
      txHash,
    };
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Fetch strategy with wallet and manifest
   */
  private async fetchStrategyWithWallet(
    strategyId: string,
    expectedStatus: string
  ): Promise<{
    strategy: any;
    wallet: any;
    walletConfig: { walletAddress: Address; kmsKeyId: string };
    manifest: any;
  }> {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      include: {
        manifest: true,
        automationWallets: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!strategy) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' not found`,
        'STRATEGY_NOT_FOUND',
        404
      );
    }

    if (strategy.status !== expectedStatus) {
      throw new StrategySigningError(
        `Strategy is in '${strategy.status}' state, expected '${expectedStatus}'`,
        'INVALID_STATE',
        400
      );
    }

    if (!strategy.manifest) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' has no manifest`,
        'MANIFEST_NOT_FOUND',
        404
      );
    }

    const wallet = strategy.automationWallets[0];
    if (!wallet) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' has no automation wallet`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    const walletConfig = wallet.config as { walletAddress: Address; kmsKeyId: string };

    return { strategy, wallet, walletConfig, manifest: strategy.manifest };
  }

  /**
   * Sign a transaction with KMS
   */
  private async signTransaction(
    tx: {
      to?: Address;
      data: Hex;
      chainId: number;
      nonce: number;
      gas: bigint;
      gasPrice: bigint;
      type: 'legacy';
    },
    kmsKeyId: string,
    chainId: number
  ): Promise<Hex> {
    const serializedUnsigned = serializeTransaction(tx);
    const txHash = keccak256(serializedUnsigned);

    const signer = getSigner();
    const signature = await signer.signTransaction(kmsKeyId, txHash);

    // Calculate EIP-155 v value
    const recoveryId = signature.v >= 27 ? signature.v - 27 : signature.v;
    const eip155V = BigInt(chainId * 2 + 35 + recoveryId);

    // Serialize with signature
    const signedTx = serializeTransaction(tx, {
      r: signature.r,
      s: signature.s,
      v: eip155V,
    });

    return signedTx;
  }

  /**
   * Build constructor arguments from manifest params
   */
  private buildConstructorArgs(
    params: ConstructorParam[],
    userValues: Record<string, string>,
    ownerAddress: string,
    automationWalletAddress: string
  ): unknown[] {
    return params.map((param) => {
      let value: string;

      switch (param.source) {
        case 'user-wallet':
          value = ownerAddress;
          break;

        case 'automation-wallet':
          value = automationWalletAddress;
          break;

        case 'user-input':
          value = userValues[param.name];
          if (!value && param.default) {
            value = param.default;
          }
          if (!value && param.required !== false) {
            throw new StrategySigningError(
              `Missing required constructor parameter: ${param.name}`,
              'INTERNAL_ERROR',
              400
            );
          }
          break;

        case 'derived':
          throw new StrategySigningError(
            `Derived constructor parameters not yet supported: ${param.name}`,
            'INTERNAL_ERROR',
            400
          );

        default:
          throw new StrategySigningError(
            `Unknown parameter source: ${param.source}`,
            'INTERNAL_ERROR',
            400
          );
      }

      return this.convertParamValue(value, param.type);
    });
  }

  /**
   * Convert parameter value to the appropriate type
   */
  private convertParamValue(value: string, solidityType: string): unknown {
    if (solidityType === 'address') {
      return value as Address;
    }

    if (solidityType.startsWith('uint') || solidityType.startsWith('int')) {
      return BigInt(value);
    }

    if (solidityType === 'bool') {
      return value === 'true' || value === '1';
    }

    if (solidityType === 'bytes32') {
      if (value.startsWith('0x')) {
        return value as Hex;
      }
      return `0x${value.padStart(64, '0')}` as Hex;
    }

    return value;
  }
}

// Export singleton instance
export const strategySigningService = new StrategySigningService();
