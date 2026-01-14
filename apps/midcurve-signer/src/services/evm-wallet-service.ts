/**
 * EVM Automation Wallet Service
 *
 * Manages the lifecycle of EVM automation wallets:
 * - Create wallets (KMS key generation + database record)
 * - Retrieve wallet information
 * - Update wallet status
 *
 * Each STRATEGY has ONE automation wallet (enforced by walletHash uniqueness).
 * A user can have multiple strategies, each with its own automation wallet.
 */

import { prisma, Prisma, type Prisma as PrismaTypes } from '../lib/prisma';
import { getSigner, type KmsWalletCreationResult } from '../lib/kms';
import { signerLogger, signerLog } from '../lib/logger';
import type { Address } from 'viem';

// =============================================================================
// Types
// =============================================================================

/**
 * EVM-specific config stored in AutomationWallet.config
 */
export interface EvmWalletConfig {
  strategyAddress: string; // EVM address (EIP-55)
  walletAddress: string; // EVM address (EIP-55)
  kmsKeyId: string;
  keyProvider: 'aws-kms' | 'local-encrypted';
  /**
   * Encrypted private key (LocalDevSigner only)
   * For AWS KMS, this is undefined as keys never leave the HSM.
   */
  encryptedPrivateKey?: string;
}

/**
 * Result from creating a new wallet
 */
export interface CreateEvmWalletResult {
  id: string;
  strategyAddress: Address;
  userId: string;
  walletAddress: Address;
  label: string;
  kmsKeyId: string;
  keyProvider: string;
  createdAt: Date;
}

/**
 * Wallet information returned to callers
 */
export interface EvmWalletInfo {
  id: string;
  strategyAddress: Address;
  userId: string;
  walletAddress: Address;
  label: string;
  keyProvider: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
}

/**
 * Input for creating a new wallet
 */
export interface CreateEvmWalletInput {
  strategyAddress: Address;
  userId: string;
  label: string;
}

/**
 * Service errors
 */
export class EvmWalletServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'EvmWalletServiceError';
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate walletHash for EVM wallets
 * Format: "evm/{walletAddress}" - uses the actual signing wallet address
 *
 * Note: For lookups by strategyAddress (contract address), use the Strategy table:
 *   Strategy.contractAddress → strategyId → AutomationWallet.strategyId
 */
function createEvmWalletHash(walletAddress: string): string {
  return `evm/${walletAddress.toLowerCase()}`;
}

/**
 * Parse EvmWalletConfig from JSON
 */
function parseEvmWalletConfig(config: unknown): EvmWalletConfig {
  const c = config as EvmWalletConfig;
  return {
    strategyAddress: c.strategyAddress,
    walletAddress: c.walletAddress,
    kmsKeyId: c.kmsKeyId,
    keyProvider: c.keyProvider,
    encryptedPrivateKey: c.encryptedPrivateKey,
  };
}

// =============================================================================
// Service
// =============================================================================

const WALLET_TYPE = 'evm';

class EvmWalletService {
  private readonly logger = signerLogger.child({ service: 'EvmWalletService' });

  /**
   * Create a new automation wallet for a strategy
   *
   * This creates a KMS key and stores the wallet record in the database.
   * Each strategy can only have one automation wallet.
   *
   * @throws EvmWalletServiceError if strategy already has a wallet or creation fails
   */
  async createWallet(input: CreateEvmWalletInput): Promise<CreateEvmWalletResult> {
    const { strategyAddress, userId, label } = input;
    signerLog.methodEntry(this.logger, 'createWallet', { strategyAddress, userId, label });

    try {
      // Check if strategy already has a wallet via the Strategy table relation
      // This is more reliable than walletHash for strategy-bound wallets
      const existingStrategy = await prisma.strategy.findFirst({
        where: { contractAddress: strategyAddress },
        include: { automationWallets: { where: { walletType: WALLET_TYPE, isActive: true } } },
      });

      if (existingStrategy?.automationWallets.length) {
        throw new EvmWalletServiceError(
          'Strategy already has an automation wallet',
          'WALLET_EXISTS',
          409
        );
      }

      // Create KMS key
      const signer = getSigner();
      const kmsResult: KmsWalletCreationResult = await signer.createKey(
        `${strategyAddress}:${label}`
      );

      // Build EVM-specific config
      const config: EvmWalletConfig = {
        strategyAddress,
        walletAddress: kmsResult.walletAddress,
        kmsKeyId: kmsResult.keyId,
        keyProvider: kmsResult.encryptedPrivateKey ? 'local-encrypted' : 'aws-kms',
        // Store encrypted key for local dev (undefined for AWS KMS)
        encryptedPrivateKey: kmsResult.encryptedPrivateKey,
      };

      // walletHash uses the actual wallet address (not strategy address)
      const walletHash = createEvmWalletHash(kmsResult.walletAddress);

      // Create database record
      // Note: strategyId is set later when the strategy is created in the API
      const wallet = await prisma.automationWallet.create({
        data: {
          walletType: WALLET_TYPE,
          userId,
          label,
          walletHash,
          config: config as unknown as PrismaTypes.InputJsonValue,
          isActive: true,
        },
      });

      this.logger.info({
        strategyAddress,
        userId,
        walletAddress: config.walletAddress,
        msg: 'Automation wallet created for strategy',
      });

      signerLog.methodExit(this.logger, 'createWallet', {
        walletId: wallet.id,
        walletAddress: config.walletAddress,
      });

      return {
        id: wallet.id,
        strategyAddress: config.strategyAddress as Address,
        userId: wallet.userId,
        walletAddress: config.walletAddress as Address,
        label: wallet.label,
        kmsKeyId: config.kmsKeyId,
        keyProvider: config.keyProvider,
        createdAt: wallet.createdAt,
      };
    } catch (error) {
      if (error instanceof EvmWalletServiceError) {
        throw error;
      }

      // Handle Prisma unique constraint violation
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new EvmWalletServiceError(
          'Wallet already exists for this strategy',
          'WALLET_EXISTS',
          409
        );
      }

      signerLog.methodError(this.logger, 'createWallet', error, { strategyAddress });
      throw new EvmWalletServiceError(
        'Failed to create wallet',
        'CREATE_FAILED',
        500
      );
    }
  }

  /**
   * Get wallet by strategy address (contract address)
   *
   * Uses the Strategy table relation for lookup:
   *   Strategy.contractAddress → strategyId → AutomationWallet.strategyId
   */
  async getWalletByStrategyAddress(strategyAddress: Address): Promise<EvmWalletInfo | null> {
    signerLog.methodEntry(this.logger, 'getWalletByStrategyAddress', { strategyAddress });

    // Look up via Strategy table relation
    const strategy = await prisma.strategy.findFirst({
      where: { contractAddress: strategyAddress.toLowerCase() },
      include: {
        automationWallets: {
          where: { walletType: WALLET_TYPE, isActive: true },
          take: 1,
        },
      },
    });

    const wallet = strategy?.automationWallets[0];

    if (!wallet) {
      return null;
    }

    const config = parseEvmWalletConfig(wallet.config);

    return {
      id: wallet.id,
      strategyAddress: config.strategyAddress as Address,
      userId: wallet.userId,
      walletAddress: config.walletAddress as Address,
      label: wallet.label,
      keyProvider: config.keyProvider,
      isActive: wallet.isActive,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      lastUsedAt: wallet.lastUsedAt,
    };
  }

  /**
   * Get all EVM wallets for a user (across all strategies)
   */
  async getWalletsByUserId(userId: string): Promise<EvmWalletInfo[]> {
    signerLog.methodEntry(this.logger, 'getWalletsByUserId', { userId });

    const wallets = await prisma.automationWallet.findMany({
      where: { userId, walletType: WALLET_TYPE, isActive: true },
    });

    return wallets.map((wallet) => {
      const config = parseEvmWalletConfig(wallet.config);
      return {
        id: wallet.id,
        strategyAddress: config.strategyAddress as Address,
        userId: wallet.userId,
        walletAddress: config.walletAddress as Address,
        label: wallet.label,
        keyProvider: config.keyProvider,
        isActive: wallet.isActive,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
        lastUsedAt: wallet.lastUsedAt,
      };
    });
  }

  /**
   * Get wallet by wallet address
   */
  async getWalletByAddress(walletAddress: Address): Promise<EvmWalletInfo | null> {
    signerLog.methodEntry(this.logger, 'getWalletByAddress', { walletAddress });

    // Query all active EVM wallets and filter by wallet address in config
    // Note: For better performance at scale, consider adding a separate index column
    const wallets = await prisma.automationWallet.findMany({
      where: { walletType: WALLET_TYPE, isActive: true },
    });

    const wallet = wallets.find((w) => {
      const config = parseEvmWalletConfig(w.config);
      return config.walletAddress.toLowerCase() === walletAddress.toLowerCase();
    });

    if (!wallet) {
      return null;
    }

    const config = parseEvmWalletConfig(wallet.config);

    return {
      id: wallet.id,
      strategyAddress: config.strategyAddress as Address,
      userId: wallet.userId,
      walletAddress: config.walletAddress as Address,
      label: wallet.label,
      keyProvider: config.keyProvider,
      isActive: wallet.isActive,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      lastUsedAt: wallet.lastUsedAt,
    };
  }

  /**
   * Get the KMS key ID for a strategy's wallet (internal use only)
   *
   * Uses the Strategy table relation for lookup.
   */
  async getKmsKeyId(strategyAddress: Address): Promise<string | null> {
    // Look up via Strategy table relation
    const strategy = await prisma.strategy.findFirst({
      where: { contractAddress: strategyAddress.toLowerCase() },
      include: {
        automationWallets: {
          where: { walletType: WALLET_TYPE, isActive: true },
          select: { config: true },
          take: 1,
        },
      },
    });

    const wallet = strategy?.automationWallets[0];

    if (!wallet) {
      return null;
    }

    const config = parseEvmWalletConfig(wallet.config);
    return config.kmsKeyId;
  }

  /**
   * Update last used timestamp for a strategy's wallet
   *
   * Uses the Strategy table relation for lookup.
   */
  async updateLastUsed(strategyAddress: Address): Promise<void> {
    // Look up via Strategy table relation
    const strategy = await prisma.strategy.findFirst({
      where: { contractAddress: strategyAddress.toLowerCase() },
      include: {
        automationWallets: {
          where: { walletType: WALLET_TYPE, isActive: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    const wallet = strategy?.automationWallets[0];
    if (wallet) {
      await prisma.automationWallet.update({
        where: { id: wallet.id },
        data: { lastUsedAt: new Date() },
      });
    }
  }

  /**
   * Deactivate a strategy's wallet (soft delete)
   *
   * Uses the Strategy table relation for lookup.
   */
  async deactivateWallet(strategyAddress: Address): Promise<boolean> {
    signerLog.methodEntry(this.logger, 'deactivateWallet', { strategyAddress });

    // Look up via Strategy table relation
    const strategy = await prisma.strategy.findFirst({
      where: { contractAddress: strategyAddress.toLowerCase() },
      include: {
        automationWallets: {
          where: { walletType: WALLET_TYPE, isActive: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    const wallet = strategy?.automationWallets[0];
    if (!wallet) {
      return false;
    }

    await prisma.automationWallet.update({
      where: { id: wallet.id },
      data: { isActive: false },
    });

    this.logger.info({
      strategyAddress,
      msg: 'Automation wallet deactivated',
    });
    return true;
  }
}

// Export singleton instance
export const evmWalletService = new EvmWalletService();
