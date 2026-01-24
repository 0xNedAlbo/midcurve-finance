/**
 * Automation Wallet Service
 *
 * Manages per-user automation wallets for position automation.
 * Unlike strategy wallets, automation wallets are:
 * - One per user (not per strategy)
 * - Shared across all positions/chains
 * - Used for signing automation contract transactions (deploy, register, execute, cancel)
 *
 * Key differences from EvmWalletService:
 * - walletPurpose = 'automation' (not 'strategy')
 * - strategyId = null (not linked to a strategy)
 * - One wallet per user (enforced by unique constraint)
 */

import { PrismaClient, type AutomationWallet, type Prisma } from '@midcurve/database';
import type { Address } from 'viem';
import { signerLogger } from '@/lib/logger';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import * as crypto from 'crypto';

// Constants
const WALLET_TYPE = 'evm';
const WALLET_PURPOSE = 'automation';
const DEFAULT_LABEL = 'Position Automation Wallet';

/**
 * Environment configuration for key management
 */
interface KeyManagementConfig {
  useLocalKeys: boolean;
  encryptionPassword?: string;
  kmsKeyId?: string;
}

/**
 * Get key management configuration from environment
 */
function getKeyManagementConfig(): KeyManagementConfig {
  const useLocalKeys = process.env.SIGNER_USE_LOCAL_KEYS === 'true';
  const encryptionPassword = process.env.SIGNER_LOCAL_ENCRYPTION_KEY;
  const kmsKeyId = process.env.AWS_KMS_KEY_ID;

  if (useLocalKeys && !encryptionPassword) {
    throw new AutomationWalletServiceError(
      'SIGNER_LOCAL_ENCRYPTION_KEY is required when SIGNER_USE_LOCAL_KEYS=true',
      'CONFIGURATION_ERROR',
      500
    );
  }

  if (!useLocalKeys && !kmsKeyId) {
    throw new AutomationWalletServiceError(
      'AWS_KMS_KEY_ID is required when not using local keys',
      'CONFIGURATION_ERROR',
      500
    );
  }

  return {
    useLocalKeys,
    encryptionPassword,
    kmsKeyId,
  };
}

/**
 * EVM-specific wallet configuration for automation
 */
export interface EvmAutomationWalletConfig {
  walletAddress: string;
  kmsKeyId: string | null;
  keyProvider: 'local' | 'kms';
  encryptedPrivateKey: string | null;
}

/**
 * Input for creating an automation wallet
 */
export interface CreateAutomationWalletInput {
  userId: string;
  label?: string;
}

/**
 * Output from wallet operations
 */
export interface AutomationWalletOutput {
  id: string;
  userId: string;
  walletAddress: Address;
  label: string;
  keyProvider: 'local' | 'kms';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
}

/**
 * Service error class
 */
export class AutomationWalletServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AutomationWalletServiceError';
  }
}

/**
 * Encryption utilities for local key management
 */
function encryptPrivateKey(privateKey: string, password: string): string {
  const algorithm = 'aes-256-gcm';
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Format: salt:iv:authTag:encryptedData
  return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptPrivateKey(encryptedData: string, password: string): string {
  const algorithm = 'aes-256-gcm';
  const parts = encryptedData.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }

  const [saltHex, ivHex, authTagHex, encrypted] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Automation Wallet Service
 *
 * Manages per-user automation wallets for EVM chains.
 */
class AutomationWalletServiceImpl {
  private readonly prisma: PrismaClient;
  private readonly logger = signerLogger.child({ service: 'AutomationWalletService' });

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Create wallet hash for uniqueness lookup
   * Format: "evm/automation/{walletAddress}"
   */
  private createWalletHash(walletAddress: string): string {
    return `evm/automation/${walletAddress.toLowerCase()}`;
  }

  /**
   * Create a new automation wallet for a user
   *
   * Creates a per-user automation wallet backed by KMS or local encryption.
   * Each user can only have ONE automation wallet.
   */
  async createWallet(input: CreateAutomationWalletInput): Promise<AutomationWalletOutput> {
    const { userId, label = DEFAULT_LABEL } = input;

    this.logger.info({ userId, label }, 'Creating automation wallet');

    // Check if user already has an automation wallet
    const existing = await this.getWalletByUserId(userId);
    if (existing) {
      throw new AutomationWalletServiceError(
        `User ${userId} already has an automation wallet`,
        'WALLET_EXISTS',
        409
      );
    }

    // Get key management config
    const keyConfig = getKeyManagementConfig();

    // Generate new private key
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const walletAddress = account.address;

    // Prepare config based on key provider
    let config: EvmAutomationWalletConfig;

    if (keyConfig.useLocalKeys) {
      // Encrypt and store locally
      const encryptedPrivateKey = encryptPrivateKey(privateKey, keyConfig.encryptionPassword!);

      config = {
        walletAddress,
        kmsKeyId: null,
        keyProvider: 'local',
        encryptedPrivateKey,
      };

      this.logger.debug({ userId, walletAddress }, 'Using local encrypted key storage');
    } else {
      // Use AWS KMS
      // TODO: Implement KMS key creation
      // For now, throw error if KMS is required but not implemented
      throw new AutomationWalletServiceError(
        'KMS key management not yet implemented for automation wallets',
        'NOT_IMPLEMENTED',
        501
      );
    }

    // Create wallet hash
    const walletHash = this.createWalletHash(walletAddress);

    // Create wallet in database
    const wallet = await this.prisma.automationWallet.create({
      data: {
        walletType: WALLET_TYPE,
        walletPurpose: WALLET_PURPOSE,
        userId,
        label,
        walletHash,
        config: config as unknown as Prisma.InputJsonValue,
        isActive: true,
      },
    });

    this.logger.info(
      { userId, walletId: wallet.id, walletAddress },
      'Automation wallet created successfully'
    );

    return this.mapToOutput(wallet);
  }

  /**
   * Get automation wallet by user ID
   *
   * Returns the user's automation wallet, or null if not found.
   */
  async getWalletByUserId(userId: string): Promise<AutomationWalletOutput | null> {
    const wallet = await this.prisma.automationWallet.findFirst({
      where: {
        userId,
        walletPurpose: WALLET_PURPOSE,
        isActive: true,
      },
    });

    if (!wallet) {
      return null;
    }

    return this.mapToOutput(wallet);
  }

  /**
   * Get automation wallet by wallet address
   */
  async getWalletByAddress(walletAddress: string): Promise<AutomationWalletOutput | null> {
    const walletHash = this.createWalletHash(walletAddress);

    const wallet = await this.prisma.automationWallet.findUnique({
      where: { walletHash },
    });

    if (!wallet || wallet.walletPurpose !== WALLET_PURPOSE) {
      return null;
    }

    return this.mapToOutput(wallet);
  }

  /**
   * Get or create automation wallet for a user
   *
   * Returns existing wallet or creates a new one if not found.
   */
  async getOrCreateWallet(input: CreateAutomationWalletInput): Promise<AutomationWalletOutput> {
    const existing = await this.getWalletByUserId(input.userId);
    if (existing) {
      return existing;
    }

    return this.createWallet(input);
  }

  /**
   * Get decrypted private key for signing
   *
   * WARNING: This returns the raw private key. Handle with extreme care.
   * Only call this when you need to sign a transaction.
   */
  async getPrivateKey(walletId: string): Promise<`0x${string}`> {
    const wallet = await this.prisma.automationWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new AutomationWalletServiceError(
        `Wallet ${walletId} not found`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    if (wallet.walletPurpose !== WALLET_PURPOSE) {
      throw new AutomationWalletServiceError(
        `Wallet ${walletId} is not an automation wallet`,
        'INVALID_WALLET_TYPE',
        400
      );
    }

    const config = wallet.config as unknown as EvmAutomationWalletConfig;

    if (config.keyProvider === 'local') {
      if (!config.encryptedPrivateKey) {
        throw new AutomationWalletServiceError(
          `Wallet ${walletId} has no encrypted private key`,
          'KEY_NOT_FOUND',
          500
        );
      }

      const keyConfig = getKeyManagementConfig();
      const privateKey = decryptPrivateKey(
        config.encryptedPrivateKey,
        keyConfig.encryptionPassword!
      );

      return privateKey as `0x${string}`;
    } else {
      // KMS
      throw new AutomationWalletServiceError(
        'KMS key retrieval not yet implemented for automation wallets',
        'NOT_IMPLEMENTED',
        501
      );
    }
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(walletId: string): Promise<void> {
    await this.prisma.automationWallet.update({
      where: { id: walletId },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Deactivate a wallet
   */
  async deactivateWallet(walletId: string): Promise<void> {
    await this.prisma.automationWallet.update({
      where: { id: walletId },
      data: { isActive: false },
    });

    this.logger.info({ walletId }, 'Automation wallet deactivated');
  }

  /**
   * Map database record to output
   */
  private mapToOutput(wallet: AutomationWallet): AutomationWalletOutput {
    const config = wallet.config as unknown as EvmAutomationWalletConfig;

    return {
      id: wallet.id,
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
}

// Export singleton instance
export const automationWalletService = new AutomationWalletServiceImpl();
export { AutomationWalletServiceImpl };
