/**
 * Strategy Deployment Service
 *
 * Orchestrates the deployment of strategy contracts:
 * 1. Fetches strategy and manifest from database
 * 2. Creates automation wallet (KMS-backed)
 * 3. Builds constructor parameters from manifest
 * 4. Deploys contract to SEMSEE chain
 * 5. Updates strategy with contract address
 *
 * This service is called by POST /api/strategy/deploy
 */

import {
  createPublicClient,
  http,
  encodeDeployData,
  type Address,
  type Hex,
  type Abi,
  type TransactionReceipt,
  keccak256,
  serializeTransaction,
} from 'viem';
import { prisma } from '../lib/prisma';
import { evmWalletService, type CreateEvmWalletResult } from './evm-wallet-service';
import { getSigner } from '../lib/kms';
import { signerLogger, signerLog } from '../lib/logger';

// =============================================================================
// Types
// =============================================================================

/**
 * Input for deploying a strategy
 */
export interface DeployStrategyInput {
  strategyId: string;
  chainId: number;
  ownerAddress: string;
}

/**
 * Result from strategy deployment
 */
export interface DeployStrategyResult {
  contractAddress: Address;
  transactionHash: Hex;
  automationWallet: {
    id: string;
    address: Address;
  };
  blockNumber: number;
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
export type DeploymentErrorCode =
  | 'STRATEGY_NOT_FOUND'
  | 'MANIFEST_NOT_FOUND'
  | 'INVALID_STATE'
  | 'WALLET_CREATION_FAILED'
  | 'DEPLOYMENT_FAILED'
  | 'ALREADY_DEPLOYED'
  | 'INTERNAL_ERROR';

/**
 * Service error
 */
export class StrategyDeploymentError extends Error {
  constructor(
    message: string,
    public readonly code: DeploymentErrorCode,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'StrategyDeploymentError';
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

class StrategyDeploymentService {
  private readonly logger = signerLogger.child({ service: 'StrategyDeploymentService' });

  /**
   * Deploy a strategy contract
   *
   * Full deployment flow:
   * 1. Fetch strategy and validate state
   * 2. Fetch manifest and validate
   * 3. Check for existing automation wallet or create new one
   * 4. Build constructor arguments
   * 5. Deploy contract
   * 6. Update strategy with contract address
   */
  async deployStrategy(input: DeployStrategyInput): Promise<DeployStrategyResult> {
    const { strategyId, chainId, ownerAddress } = input;
    signerLog.methodEntry(this.logger, 'deployStrategy', { strategyId, chainId, ownerAddress });

    // 1. Fetch strategy with manifest
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      include: {
        manifest: true,
      },
    });

    if (!strategy) {
      throw new StrategyDeploymentError(
        `Strategy '${strategyId}' not found`,
        'STRATEGY_NOT_FOUND',
        404
      );
    }

    // 2. Validate strategy state
    if (strategy.state !== 'pending') {
      throw new StrategyDeploymentError(
        `Strategy is in '${strategy.state}' state, expected 'pending'`,
        'INVALID_STATE',
        400
      );
    }

    // 3. Check if already deployed
    if (strategy.contractAddress) {
      throw new StrategyDeploymentError(
        `Strategy already deployed at ${strategy.contractAddress}`,
        'ALREADY_DEPLOYED',
        400
      );
    }

    // 4. Validate manifest exists
    if (!strategy.manifest) {
      throw new StrategyDeploymentError(
        `Strategy '${strategyId}' has no manifest`,
        'MANIFEST_NOT_FOUND',
        404
      );
    }

    const manifest = strategy.manifest;

    this.logger.info({
      strategyId,
      manifestSlug: manifest.slug,
      chainId,
      ownerAddress,
      msg: 'Starting strategy deployment',
    });

    // 5. Create automation wallet
    // Use strategy ID as basis for wallet hash - will be unique per strategy
    let wallet: CreateEvmWalletResult;

    try {
      // For new deployments, we use strategyId as the unique identifier
      // The wallet hash will be updated after deployment with the actual contract address
      wallet = await evmWalletService.createWallet({
        strategyAddress: `0x${strategyId.replace(/-/g, '').slice(0, 40).padStart(40, '0')}` as Address,
        userId: strategy.userId,
        label: `${strategy.name} - Automation Wallet`,
      });

      this.logger.info({
        strategyId,
        walletId: wallet.id,
        walletAddress: wallet.walletAddress,
        msg: 'Automation wallet created',
      });
    } catch (error) {
      this.logger.error({
        strategyId,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to create automation wallet',
      });
      throw new StrategyDeploymentError(
        'Failed to create automation wallet',
        'WALLET_CREATION_FAILED',
        500,
        error instanceof Error ? error.message : String(error)
      );
    }

    // 6. Build constructor arguments
    const constructorParams = manifest.constructorParams as unknown as ConstructorParam[];
    const constructorValues = ((strategy.config as Record<string, unknown>)?._constructorValues ?? {}) as Record<string, string>;

    const constructorArgs = this.buildConstructorArgs(
      constructorParams,
      constructorValues,
      ownerAddress,
      wallet.walletAddress
    );

    this.logger.info({
      strategyId,
      constructorArgs,
      msg: 'Constructor arguments built',
    });

    // 7. Deploy contract
    let deployResult: { contractAddress: Address; transactionHash: Hex; blockNumber: number };

    try {
      deployResult = await this.deployContract({
        bytecode: manifest.bytecode as Hex,
        abi: manifest.abi as unknown as Abi,
        constructorArgs,
        chainId,
        walletId: wallet.id,
        kmsKeyId: wallet.kmsKeyId,
        walletAddress: wallet.walletAddress,
      });

      this.logger.info({
        strategyId,
        contractAddress: deployResult.contractAddress,
        transactionHash: deployResult.transactionHash,
        blockNumber: deployResult.blockNumber,
        msg: 'Contract deployed successfully',
      });
    } catch (error) {
      this.logger.error({
        strategyId,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Contract deployment failed',
      });
      throw new StrategyDeploymentError(
        'Contract deployment failed',
        'DEPLOYMENT_FAILED',
        500,
        error instanceof Error ? error.message : String(error)
      );
    }

    // 8. Update strategy with contract address
    await prisma.strategy.update({
      where: { id: strategyId },
      data: {
        contractAddress: deployResult.contractAddress,
        chainId,
        // Keep state as 'pending' - will transition to 'active' after start() signature
      },
    });

    this.logger.info({
      strategyId,
      contractAddress: deployResult.contractAddress,
      msg: 'Strategy updated with contract address',
    });

    signerLog.methodExit(this.logger, 'deployStrategy', {
      contractAddress: deployResult.contractAddress,
      transactionHash: deployResult.transactionHash,
    });

    return {
      contractAddress: deployResult.contractAddress,
      transactionHash: deployResult.transactionHash,
      automationWallet: {
        id: wallet.id,
        address: wallet.walletAddress,
      },
      blockNumber: deployResult.blockNumber,
    };
  }

  /**
   * Build constructor arguments from manifest params and provided values
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
            throw new StrategyDeploymentError(
              `Missing required constructor parameter: ${param.name}`,
              'INTERNAL_ERROR',
              400
            );
          }
          break;

        case 'derived':
          // Future: implement derivation logic
          throw new StrategyDeploymentError(
            `Derived constructor parameters not yet supported: ${param.name}`,
            'INTERNAL_ERROR',
            400
          );

        default:
          throw new StrategyDeploymentError(
            `Unknown parameter source: ${param.source}`,
            'INTERNAL_ERROR',
            400
          );
      }

      // Convert value based on type
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
      // Pad or truncate to 32 bytes
      if (value.startsWith('0x')) {
        return value as Hex;
      }
      return `0x${value.padStart(64, '0')}` as Hex;
    }

    // string and other types pass through
    return value;
  }

  /**
   * Deploy contract to SEMSEE chain
   */
  private async deployContract(params: {
    bytecode: Hex;
    abi: Abi;
    constructorArgs: unknown[];
    chainId: number;
    walletId: string;
    kmsKeyId: string;
    walletAddress: Address;
  }): Promise<{ contractAddress: Address; transactionHash: Hex; blockNumber: number }> {
    const { bytecode, abi, constructorArgs, chainId, kmsKeyId, walletAddress } = params;

    // Create public client for gas estimation and transaction receipt
    const publicClient = createSemseePublicClient(chainId);

    // Encode deployment data (bytecode + encoded constructor args)
    const deployData = encodeDeployData({
      abi,
      bytecode,
      args: constructorArgs,
    });

    // Get current gas price
    const gasPrice = await publicClient.getGasPrice();

    // Estimate gas for deployment
    const gasEstimate = await publicClient.estimateGas({
      account: walletAddress,
      data: deployData,
    });

    // Add 20% buffer to gas estimate
    const gasLimit = (gasEstimate * 120n) / 100n;

    // Get nonce from chain (for new wallets, this should be 0)
    const nonce = await publicClient.getTransactionCount({
      address: walletAddress,
    });

    this.logger.info({
      walletAddress,
      nonce,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      msg: 'Preparing deployment transaction',
    });

    // Build the transaction
    const tx = {
      to: undefined, // Contract deployment has no 'to' address
      data: deployData,
      chainId,
      nonce,
      gas: gasLimit,
      gasPrice,
      type: 'legacy' as const,
    };

    // Hash the transaction for signing
    const serializedUnsigned = serializeTransaction(tx);
    const txHash = keccak256(serializedUnsigned);

    // Sign with KMS
    const signer = getSigner();
    const signature = await signer.signTransaction(kmsKeyId, txHash);

    // Serialize with signature
    const signedTx = serializeTransaction(tx, {
      r: signature.r,
      s: signature.s,
      v: BigInt(signature.v + 27), // Add 27 for legacy transactions
    });

    this.logger.info({
      walletAddress,
      txHash,
      msg: 'Transaction signed, broadcasting to SEMSEE',
    });

    // Broadcast transaction
    const hash = await publicClient.sendRawTransaction({
      serializedTransaction: signedTx,
    });

    this.logger.info({
      transactionHash: hash,
      msg: 'Transaction broadcast, waiting for confirmation',
    });

    // Wait for receipt
    const receipt: TransactionReceipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000, // 60 second timeout
    });

    if (receipt.status === 'reverted') {
      throw new Error('Contract deployment reverted');
    }

    if (!receipt.contractAddress) {
      throw new Error('No contract address in receipt');
    }

    return {
      contractAddress: receipt.contractAddress,
      transactionHash: hash,
      blockNumber: Number(receipt.blockNumber),
    };
  }
}

// Export singleton instance
export const strategyDeploymentService = new StrategyDeploymentService();
