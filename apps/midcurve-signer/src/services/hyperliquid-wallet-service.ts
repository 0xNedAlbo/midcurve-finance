/**
 * Hyperliquid Wallet Service
 *
 * Manages per-user Hyperliquid API wallets for hedging operations.
 *
 * Key differences from AutomationWalletService:
 * - importWallet() instead of createWallet() - accepts user-provided key
 * - Users create API wallets on hyperliquid.xyz and provide the private key
 * - We encrypt and store the user-provided key
 * - One wallet per user (enforced by unique constraint)
 * - walletType = 'hyperliquid'
 * - walletPurpose = 'hyperliquid'
 */

import { PrismaClient, type AutomationWallet, type Prisma } from '@midcurve/database';
import type { Address } from 'viem';
import { signerLogger } from '@/lib/logger';
import { privateKeyToAccount } from 'viem/accounts';
import * as crypto from 'crypto';

// Constants
const WALLET_TYPE = 'hyperliquid';
const WALLET_PURPOSE = 'hyperliquid';
const DEFAULT_LABEL = 'Hyperliquid API Wallet';

/**
 * Hyperliquid wallet configuration stored in AutomationWallet.config
 */
export interface HyperliquidWalletConfig {
  walletAddress: string;
  keyProvider: 'local';
  encryptedPrivateKey: string;
  validUntil?: string; // ISO timestamp when wallet expires
}

/**
 * Input for importing a Hyperliquid wallet
 */
export interface ImportHyperliquidWalletInput {
  userId: string;
  privateKey: `0x${string}`;
  label?: string;
  validityDays?: number; // Optional validity period in days (1-180)
}

/**
 * Output from wallet operations
 */
export interface HyperliquidWalletOutput {
  id: string;
  userId: string;
  walletAddress: Address;
  label: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  validUntil: Date | null; // When wallet expires, or null if no expiry
}

/**
 * Service error class
 */
export class HyperliquidWalletServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HyperliquidWalletServiceError';
  }
}

/**
 * Get encryption password from environment
 */
function getEncryptionPassword(): string {
  const password = process.env.SIGNER_LOCAL_ENCRYPTION_KEY;
  if (!password) {
    throw new HyperliquidWalletServiceError(
      'SIGNER_LOCAL_ENCRYPTION_KEY environment variable is required',
      'CONFIGURATION_ERROR',
      500
    );
  }
  return password;
}

/**
 * Encrypt a private key using AES-256-GCM
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

/**
 * Decrypt a private key using AES-256-GCM
 */
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
 * Hyperliquid Wallet Service
 *
 * Manages per-user Hyperliquid API wallets.
 */
class HyperliquidWalletServiceImpl {
  private readonly prisma: PrismaClient;
  private readonly logger = signerLogger.child({ service: 'HyperliquidWalletService' });

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Create wallet hash for uniqueness lookup
   * Format: "hyperliquid/{walletAddress}"
   */
  private createWalletHash(walletAddress: string): string {
    return `hyperliquid/${walletAddress.toLowerCase()}`;
  }

  /**
   * Import a Hyperliquid wallet from a user-provided private key
   *
   * Users create API wallets on hyperliquid.xyz and provide the private key.
   * We encrypt and store it for future signing operations.
   *
   * Each user can only have ONE Hyperliquid wallet.
   */
  async importWallet(input: ImportHyperliquidWalletInput): Promise<HyperliquidWalletOutput> {
    const { userId, privateKey, label = DEFAULT_LABEL, validityDays } = input;

    this.logger.info({ userId, label, validityDays }, 'Importing Hyperliquid wallet');

    // Check if user already has a Hyperliquid wallet
    const existing = await this.getWalletByUserId(userId);
    if (existing) {
      throw new HyperliquidWalletServiceError(
        `User ${userId} already has a Hyperliquid wallet`,
        'WALLET_EXISTS',
        409
      );
    }

    // Derive wallet address from private key
    let walletAddress: Address;
    try {
      const account = privateKeyToAccount(privateKey);
      walletAddress = account.address;
    } catch (error) {
      throw new HyperliquidWalletServiceError(
        'Invalid private key format',
        'INVALID_PRIVATE_KEY',
        400,
        error
      );
    }

    // Get encryption password and encrypt the key
    const password = getEncryptionPassword();
    const encryptedPrivateKey = encryptPrivateKey(privateKey, password);

    // Calculate validUntil from validityDays if provided
    const validUntil = validityDays
      ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    // Prepare config
    const config: HyperliquidWalletConfig = {
      walletAddress,
      keyProvider: 'local',
      encryptedPrivateKey,
      validUntil,
    };

    // Create wallet hash
    const walletHash = this.createWalletHash(walletAddress);

    // Check if wallet address is already registered (by another user)
    const existingByHash = await this.prisma.automationWallet.findUnique({
      where: { walletHash },
    });

    if (existingByHash) {
      throw new HyperliquidWalletServiceError(
        'This wallet address is already registered',
        'WALLET_ADDRESS_EXISTS',
        409
      );
    }

    // Create wallet in database
    const wallet = await this.prisma.automationWallet.create({
      data: {
        walletType: WALLET_TYPE,
        walletPurpose: WALLET_PURPOSE,
        userId,
        strategyId: null,
        label,
        walletHash,
        config: config as unknown as Prisma.InputJsonValue,
        isActive: true,
      },
    });

    this.logger.info(
      { userId, walletId: wallet.id, walletAddress },
      'Hyperliquid wallet imported successfully'
    );

    return this.mapToOutput(wallet);
  }

  /**
   * Get Hyperliquid wallet by user ID
   *
   * Returns the user's Hyperliquid wallet, or null if not found.
   */
  async getWalletByUserId(userId: string): Promise<HyperliquidWalletOutput | null> {
    const wallet = await this.prisma.automationWallet.findFirst({
      where: {
        userId,
        walletType: WALLET_TYPE,
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
   * Get Hyperliquid wallet by wallet address
   */
  async getWalletByAddress(walletAddress: string): Promise<HyperliquidWalletOutput | null> {
    const walletHash = this.createWalletHash(walletAddress);

    const wallet = await this.prisma.automationWallet.findUnique({
      where: { walletHash },
    });

    if (!wallet || wallet.walletType !== WALLET_TYPE || !wallet.isActive) {
      return null;
    }

    return this.mapToOutput(wallet);
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
      throw new HyperliquidWalletServiceError(
        `Wallet ${walletId} not found`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    if (wallet.walletType !== WALLET_TYPE) {
      throw new HyperliquidWalletServiceError(
        `Wallet ${walletId} is not a Hyperliquid wallet`,
        'INVALID_WALLET_TYPE',
        400
      );
    }

    const config = wallet.config as unknown as HyperliquidWalletConfig;

    if (!config.encryptedPrivateKey) {
      throw new HyperliquidWalletServiceError(
        `Wallet ${walletId} has no encrypted private key`,
        'KEY_NOT_FOUND',
        500
      );
    }

    const password = getEncryptionPassword();
    const privateKey = decryptPrivateKey(config.encryptedPrivateKey, password);

    return privateKey as `0x${string}`;
  }

  /**
   * Get private key by user ID
   *
   * Convenience method that first looks up the wallet by userId.
   */
  async getPrivateKeyByUserId(userId: string): Promise<`0x${string}`> {
    const wallet = await this.getWalletByUserId(userId);

    if (!wallet) {
      throw new HyperliquidWalletServiceError(
        `User ${userId} does not have a Hyperliquid wallet`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    return this.getPrivateKey(wallet.id);
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
   * Delete (deactivate) a wallet
   *
   * Soft delete - marks the wallet as inactive.
   */
  async deleteWallet(walletId: string): Promise<void> {
    const wallet = await this.prisma.automationWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new HyperliquidWalletServiceError(
        `Wallet ${walletId} not found`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    if (wallet.walletType !== WALLET_TYPE) {
      throw new HyperliquidWalletServiceError(
        `Wallet ${walletId} is not a Hyperliquid wallet`,
        'INVALID_WALLET_TYPE',
        400
      );
    }

    await this.prisma.automationWallet.update({
      where: { id: walletId },
      data: { isActive: false },
    });

    this.logger.info({ walletId }, 'Hyperliquid wallet deleted (deactivated)');
  }

  /**
   * Delete wallet by user ID
   *
   * Convenience method that first looks up the wallet by userId.
   */
  async deleteWalletByUserId(userId: string): Promise<void> {
    const wallet = await this.getWalletByUserId(userId);

    if (!wallet) {
      throw new HyperliquidWalletServiceError(
        `User ${userId} does not have a Hyperliquid wallet`,
        'WALLET_NOT_FOUND',
        404
      );
    }

    await this.deleteWallet(wallet.id);
  }

  /**
   * Map database record to output
   */
  private mapToOutput(wallet: AutomationWallet): HyperliquidWalletOutput {
    const config = wallet.config as unknown as HyperliquidWalletConfig;

    return {
      id: wallet.id,
      userId: wallet.userId,
      walletAddress: config.walletAddress as Address,
      label: wallet.label,
      isActive: wallet.isActive,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      lastUsedAt: wallet.lastUsedAt,
      validUntil: config.validUntil ? new Date(config.validUntil) : null,
    };
  }
}

// Export singleton instance
export const hyperliquidWalletService = new HyperliquidWalletServiceImpl();
export { HyperliquidWalletServiceImpl };
