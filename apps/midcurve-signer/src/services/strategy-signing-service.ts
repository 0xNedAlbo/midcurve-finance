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
import { CacheService } from '@midcurve/services';

// =============================================================================
// Types
// =============================================================================

/**
 * Result from signing a deployment transaction
 *
 * If needsFunding is true, the wallet needs ETH before deployment can proceed.
 * The EVM service should fund the wallet and call signDeployment again.
 */
export interface SignDeployResult {
  signedTransaction: Hex;
  predictedAddress: Address;
  nonce: number;
  txHash: Hash;
  /** True if wallet has zero balance and needs funding before deployment */
  needsFunding?: boolean;
  /** The automation wallet address (always returned for funding purposes) */
  walletAddress?: string;
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
 * Note: chainId is not configurable - we only support local SEMSEE (31337)
 * Note: ownerAddress removed - constructor params use operator-address and core-address sources
 */
export interface SignDeployInput {
  strategyId: string;
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
  source: 'operator-address' | 'core-address' | 'user-input';
  label?: string;
  description?: string;
  required?: boolean;
  default?: string;
}

/**
 * Strategy manifest structure (stored as JSON in strategy.manifest column)
 */
interface StrategyManifest {
  slug: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  abi: unknown[];
  bytecode: string;
  constructorParams: ConstructorParam[];
  tags?: string[];
}

/**
 * Deployment cache data structure (stored by API before calling EVM)
 * This is the source of truth for deployment signing - NOT the database.
 */
interface DeploymentCacheData {
  deploymentId: string;
  status: string;
  startedAt: string;
  manifest: StrategyManifest;
  name: string;
  userId: string;
  quoteTokenId: string;
  constructorValues: Record<string, string>;
  ownerAddress: string;
  // Chain config (fetched by API from EVM service)
  coreAddress: string;
  // Automation wallet info (added by signer during first signing request)
  automationWallet?: {
    walletAddress: string;
    kmsKeyId: string;
  };
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
 * SEMSEE chain ID - local EVM only
 */
const SEMSEE_CHAIN_ID = 31337;

/**
 * SEMSEE chain configuration (local Geth/Anvil)
 */
const semseeChain = {
  id: SEMSEE_CHAIN_ID,
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

/**
 * Create a public client for SEMSEE
 */
function createSemseePublicClient() {
  const rpcUrl = process.env.SEMSEE_RPC_URL || 'http://localhost:8545';
  return createPublicClient({
    chain: semseeChain,
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
   * NEW FLOW (cache-based):
   * 1. Read deployment data from CACHE (not database) - API stores this before calling EVM
   * 2. Create automation wallet on-demand if not exists
   * 3. Sign deployment transaction
   * 4. Update cache with wallet info
   *
   * @param input - Deployment signing input (strategyId is actually deploymentId)
   * @returns Signed transaction and predicted contract address
   * @throws StrategySigningError if deployment not found or signing fails
   */
  async signDeployment(input: SignDeployInput): Promise<SignDeployResult> {
    const { strategyId: deploymentId } = input; // Note: strategyId is actually deploymentId in new flow
    signerLog.methodEntry(this.logger, 'signDeployment', { deploymentId });

    // 1. Fetch deployment data from CACHE (not database!)
    const cache = CacheService.getInstance();
    const deploymentData = await cache.get<DeploymentCacheData>(`deployment:${deploymentId}`);

    if (!deploymentData) {
      throw new StrategySigningError(
        `Deployment '${deploymentId}' not found in cache`,
        'STRATEGY_NOT_FOUND',
        404
      );
    }

    // 2. Validate manifest exists
    if (!deploymentData.manifest) {
      throw new StrategySigningError(
        `Deployment '${deploymentId}' has no manifest`,
        'MANIFEST_NOT_FOUND',
        404
      );
    }

    const manifest = deploymentData.manifest;

    // 3. Validate coreAddress exists (from cache, fetched by API from EVM config)
    const coreAddress = deploymentData.coreAddress as Address | undefined;
    if (!coreAddress) {
      throw new StrategySigningError(
        'coreAddress not found in deployment data',
        'INTERNAL_ERROR',
        400
      );
    }

    // 4. Get or create automation wallet
    let walletAddress: Address;
    let kmsKeyId: string;

    if (deploymentData.automationWallet) {
      // Wallet already created (from previous attempt or stored in cache)
      walletAddress = deploymentData.automationWallet.walletAddress as Address;
      kmsKeyId = deploymentData.automationWallet.kmsKeyId;
      this.logger.info({
        deploymentId,
        walletAddress,
        msg: 'Using existing automation wallet from cache',
      });
    } else {
      // Create new automation wallet on-demand
      this.logger.info({
        deploymentId,
        userId: deploymentData.userId,
        msg: 'Creating automation wallet for deployment',
      });

      const signer = getSigner();
      const kmsResult = await signer.createKey(`deployment:${deploymentId}:operator`);

      walletAddress = kmsResult.walletAddress as Address;
      kmsKeyId = kmsResult.keyId;

      // Update cache with wallet info (for retries and later use)
      const updatedDeployment: DeploymentCacheData = {
        ...deploymentData,
        automationWallet: {
          walletAddress: kmsResult.walletAddress,
          kmsKeyId: kmsResult.keyId,
        },
      };
      await cache.set(`deployment:${deploymentId}`, updatedDeployment, 24 * 60 * 60);

      this.logger.info({
        deploymentId,
        walletAddress,
        msg: 'Automation wallet created and cached',
      });
    }

    this.logger.info({
      deploymentId,
      manifestSlug: manifest.slug,
      chainId: SEMSEE_CHAIN_ID,
      operatorAddress: walletAddress,
      coreAddress,
      msg: 'Signing deployment transaction',
    });

    // 5. Check wallet balance - if zero, return early for funding
    const publicClient = createSemseePublicClient();
    const balance = await publicClient.getBalance({ address: walletAddress });

    if (balance === 0n) {
      this.logger.info({
        deploymentId,
        walletAddress,
        msg: 'Wallet needs funding before deployment can proceed',
      });

      // Return early - wallet needs funding first
      return {
        needsFunding: true,
        walletAddress,
        signedTransaction: '0x' as Hex,
        predictedAddress: '0x0000000000000000000000000000000000000000' as Address,
        nonce: 0,
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hash,
      };
    }

    // 6. Build constructor arguments
    const constructorParams = manifest.constructorParams;
    const constructorValues = deploymentData.constructorValues || {};

    const constructorArgs = this.buildConstructorArgs(
      constructorParams,
      constructorValues,
      walletAddress,  // operator address
      coreAddress     // core address
    );

    // 7. Prepare and sign deployment transaction
    // (publicClient already created for balance check above)

    // Encode deployment data
    const deployData = encodeDeployData({
      abi: manifest.abi as unknown as Abi,
      bytecode: manifest.bytecode as Hex,
      args: constructorArgs,
    });

    // Get gas price and nonce
    const gasPrice = await publicClient.getGasPrice();
    const nonce = await publicClient.getTransactionCount({
      address: walletAddress,
    });

    // Estimate gas (with fallback for Geth Clique PoA bug)
    // Geth Clique has a known bug where estimateGas crashes with "method handler crashed"
    // Use a generous default gas limit as fallback
    let gasLimit: bigint;
    try {
      const gasEstimate = await publicClient.estimateGas({
        account: walletAddress,
        data: deployData,
      });
      gasLimit = (gasEstimate * 120n) / 100n; // 20% buffer
    } catch (error) {
      // Fallback: Use 2M gas for contract deployment (typical range: 500k-1.5M)
      this.logger.warn({
        deploymentId,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Gas estimation failed, using fallback gas limit of 2M',
      });
      gasLimit = 2_000_000n;
    }

    // Build transaction
    const tx = {
      to: undefined, // Contract deployment
      data: deployData,
      chainId: SEMSEE_CHAIN_ID,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    // Sign transaction
    const signedTx = await this.signTransaction(tx, kmsKeyId);

    // Calculate predicted contract address
    const predictedAddress = getContractAddress({
      from: walletAddress,
      nonce: BigInt(nonce),
    });

    const txHash = keccak256(signedTx);

    this.logger.info({
      deploymentId,
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
      walletAddress,
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

    if (!strategy.contractAddress) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' is not deployed`,
        'INVALID_STATE',
        400
      );
    }

    const publicClient = createSemseePublicClient();

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

    // Estimate gas (with fallback for Geth Clique PoA bug)
    let gasLimit: bigint;
    try {
      const gasEstimate = await publicClient.estimateGas({
        account: walletConfig.walletAddress,
        to: strategy.contractAddress as Address,
        data: callData,
      });
      gasLimit = (gasEstimate * 120n) / 100n;
    } catch (error) {
      // Fallback: Use 500k gas for step() call (typical range: 100k-300k)
      this.logger.warn({
        strategyId,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Gas estimation failed for step(), using fallback gas limit of 500k',
      });
      gasLimit = 500_000n;
    }

    // Build transaction
    const tx = {
      to: strategy.contractAddress as Address,
      data: callData,
      chainId: SEMSEE_CHAIN_ID,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    // Sign transaction
    const signedTx = await this.signTransaction(tx, walletConfig.kmsKeyId);
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

    if (!strategy.contractAddress) {
      throw new StrategySigningError(
        `Strategy '${strategyId}' is not deployed`,
        'INVALID_STATE',
        400
      );
    }

    const publicClient = createSemseePublicClient();

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

    // Estimate gas (with fallback for Geth Clique PoA bug)
    let gasLimit: bigint;
    try {
      const gasEstimate = await publicClient.estimateGas({
        account: walletConfig.walletAddress,
        to: strategy.contractAddress as Address,
        data: callData,
      });
      gasLimit = (gasEstimate * 120n) / 100n;
    } catch (error) {
      // Fallback: Use 500k gas for submitEffectResult() (typical range: 100k-300k)
      this.logger.warn({
        strategyId,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Gas estimation failed for submitEffectResult(), using fallback gas limit of 500k',
      });
      gasLimit = 500_000n;
    }

    // Build transaction
    const tx = {
      to: strategy.contractAddress as Address,
      data: callData,
      chainId: SEMSEE_CHAIN_ID,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    // Sign transaction
    const signedTx = await this.signTransaction(tx, walletConfig.kmsKeyId);
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
    manifest: StrategyManifest;
  }> {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      include: {
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
    // Cast JSON manifest to typed structure
    const manifest = strategy.manifest as unknown as StrategyManifest;

    return { strategy, wallet, walletConfig, manifest };
  }

  /**
   * Sign a transaction with KMS
   * Uses hardcoded SEMSEE_CHAIN_ID for EIP-155 v calculation
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
    kmsKeyId: string
  ): Promise<Hex> {
    const serializedUnsigned = serializeTransaction(tx);
    const txHash = keccak256(serializedUnsigned);

    const signer = getSigner();
    const signature = await signer.signTransaction(kmsKeyId, txHash);

    // Calculate EIP-155 v value using SEMSEE chain ID
    const recoveryId = signature.v >= 27 ? signature.v - 27 : signature.v;
    const eip155V = BigInt(SEMSEE_CHAIN_ID * 2 + 35 + recoveryId);

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
   *
   * @param params - Constructor parameter definitions from manifest
   * @param userValues - User-provided values for 'user-input' params
   * @param operatorAddress - Per-strategy automation wallet (for 'operator-address' source)
   * @param coreAddress - Core orchestrator address (for 'core-address' source)
   */
  private buildConstructorArgs(
    params: ConstructorParam[],
    userValues: Record<string, string>,
    operatorAddress: string,
    coreAddress: string
  ): unknown[] {
    return params.map((param) => {
      let value: string;

      switch (param.source) {
        case 'operator-address':
          value = operatorAddress;
          break;

        case 'core-address':
          value = coreAddress;
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
