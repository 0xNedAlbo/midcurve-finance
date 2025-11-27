/**
 * HyperliquidApiWalletService
 *
 * Manages encrypted private keys for Hyperliquid API wallets.
 * Enables backend signing of Hyperliquid operations without per-transaction user approval.
 *
 * SECURITY:
 * - Private keys are encrypted at rest using AES-256-GCM
 * - Keys are decrypted only when signing is required
 * - Never logs or exposes private keys
 */

import type { PrismaClient } from '@midcurve/database';
import { prisma } from '@midcurve/database';
import { privateKeyToAddress, type LocalAccount } from 'viem/accounts';
import { getAddress } from 'viem';

import type { SigningKeyProvider } from '../../crypto/signing-key-provider.js';
import { LocalEncryptedKeyProvider } from '../../crypto/providers/local-encrypted-provider.js';
import type {
  RegisterWalletInput,
  WalletInfo,
  TestSignInput,
  TestSignResult,
  HyperliquidEnvironment,
} from './types.js';

/**
 * Dependencies for HyperliquidApiWalletService
 */
export interface HyperliquidApiWalletServiceDependencies {
  /**
   * Prisma client instance
   */
  prisma?: PrismaClient;

  /**
   * Signing key provider (defaults to LocalEncryptedKeyProvider)
   */
  keyProvider?: SigningKeyProvider;
}

export class HyperliquidApiWalletService {
  private readonly prisma: PrismaClient;
  private readonly keyProvider: SigningKeyProvider;

  constructor(deps: HyperliquidApiWalletServiceDependencies = {}) {
    this.prisma = deps.prisma ?? prisma;
    this.keyProvider = deps.keyProvider ?? new LocalEncryptedKeyProvider();
  }

  /**
   * Register a new API wallet
   *
   * @param input - Registration input
   * @returns Wallet info (no sensitive data)
   * @throws Error if private key is invalid or wallet already exists
   */
  async registerWallet(input: RegisterWalletInput): Promise<WalletInfo> {
    const { userId, privateKey, label, environment, expiresAt } = input;

    // Validate private key format
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      throw new Error(
        'Invalid private key format. Must be 0x followed by 64 hex characters.'
      );
    }

    // Derive address from private key
    const derivedAddress = privateKeyToAddress(privateKey as `0x${string}`);
    const walletAddress = getAddress(derivedAddress); // EIP-55 checksum

    // Check for existing registration
    const existing = await this.prisma.hyperliquidApiWallet.findUnique({
      where: {
        userId_walletAddress_environment: { userId, walletAddress, environment },
      },
    });

    if (existing) {
      if (existing.isActive) {
        throw new Error(
          `Wallet ${walletAddress} is already registered for ${environment}`
        );
      }
      // Reactivate existing wallet with new key
      const encryptedPrivateKey = await this.keyProvider.storeKey(privateKey);
      const wallet = await this.prisma.hyperliquidApiWallet.update({
        where: { id: existing.id },
        data: {
          encryptedPrivateKey,
          encryptionVersion: 1,
          label,
          isActive: true,
          lastUsedAt: null,
          expiresAt,
        },
      });
      return this.toWalletInfo(wallet);
    }

    // Encrypt and store
    const encryptedPrivateKey = await this.keyProvider.storeKey(privateKey);

    const wallet = await this.prisma.hyperliquidApiWallet.create({
      data: {
        userId,
        walletAddress,
        label,
        environment,
        encryptedPrivateKey,
        encryptionVersion: 1,
        expiresAt,
      },
    });

    return this.toWalletInfo(wallet);
  }

  /**
   * List user's registered wallets
   *
   * @param userId - User ID
   * @param environment - Optional environment filter
   * @returns Array of wallet info (no sensitive data)
   */
  async listWallets(
    userId: string,
    environment?: HyperliquidEnvironment
  ): Promise<WalletInfo[]> {
    const wallets = await this.prisma.hyperliquidApiWallet.findMany({
      where: {
        userId,
        isActive: true,
        ...(environment && { environment }),
      },
      orderBy: { createdAt: 'desc' },
    });

    return wallets.map((w) => this.toWalletInfo(w));
  }

  /**
   * Get a specific wallet by ID
   *
   * @param userId - User ID (for ownership verification)
   * @param walletId - Wallet record ID
   * @returns Wallet info or null if not found
   */
  async getWallet(userId: string, walletId: string): Promise<WalletInfo | null> {
    const wallet = await this.prisma.hyperliquidApiWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet || wallet.userId !== userId || !wallet.isActive) {
      return null;
    }

    return this.toWalletInfo(wallet);
  }

  /**
   * Revoke (deactivate) a wallet
   *
   * @param userId - User ID (for ownership verification)
   * @param walletId - Wallet record ID
   * @throws Error if wallet not found or doesn't belong to user
   */
  async revokeWallet(userId: string, walletId: string): Promise<void> {
    const wallet = await this.prisma.hyperliquidApiWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet || wallet.userId !== userId) {
      throw new Error('Wallet not found or does not belong to user');
    }

    if (!wallet.isActive) {
      throw new Error('Wallet is already revoked');
    }

    await this.prisma.hyperliquidApiWallet.update({
      where: { id: walletId },
      data: { isActive: false },
    });
  }

  /**
   * Get a LocalAccount for signing operations
   *
   * @param userId - User ID (for ownership verification)
   * @param walletAddress - Wallet address
   * @param environment - Hyperliquid environment
   * @returns viem LocalAccount ready for signing
   * @throws Error if wallet not found or revoked
   */
  async getLocalAccount(
    userId: string,
    walletAddress: string,
    environment: HyperliquidEnvironment
  ): Promise<LocalAccount> {
    const normalizedAddress = getAddress(walletAddress);

    const wallet = await this.prisma.hyperliquidApiWallet.findUnique({
      where: {
        userId_walletAddress_environment: {
          userId,
          walletAddress: normalizedAddress,
          environment,
        },
      },
    });

    if (!wallet || !wallet.isActive) {
      throw new Error('Wallet not found or revoked');
    }

    // Update last used timestamp (fire-and-forget)
    this.prisma.hyperliquidApiWallet
      .update({
        where: { id: wallet.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((err) => {
        console.error('Failed to update lastUsedAt:', err);
      });

    return this.keyProvider.getLocalAccount(wallet.encryptedPrivateKey);
  }

  /**
   * Test signing to verify wallet is correctly stored
   *
   * @param input - Test sign input
   * @returns Signature and wallet address
   * @throws Error if wallet not found or signing fails
   */
  async testSign(input: TestSignInput): Promise<TestSignResult> {
    const { userId, walletId, message } = input;

    const wallet = await this.prisma.hyperliquidApiWallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet || wallet.userId !== userId || !wallet.isActive) {
      throw new Error('Wallet not found or unauthorized');
    }

    // Get account and sign
    const account = await this.keyProvider.getLocalAccount(
      wallet.encryptedPrivateKey
    );
    const signature = await account.signMessage({ message });

    // Update last used timestamp
    await this.prisma.hyperliquidApiWallet.update({
      where: { id: wallet.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      signature,
      walletAddress: wallet.walletAddress,
    };
  }

  /**
   * Check if a wallet exists and is active
   *
   * @param userId - User ID
   * @param walletAddress - Wallet address
   * @param environment - Hyperliquid environment
   * @returns true if wallet exists and is active
   */
  async hasActiveWallet(
    userId: string,
    walletAddress: string,
    environment: HyperliquidEnvironment
  ): Promise<boolean> {
    const normalizedAddress = getAddress(walletAddress);

    const wallet = await this.prisma.hyperliquidApiWallet.findUnique({
      where: {
        userId_walletAddress_environment: {
          userId,
          walletAddress: normalizedAddress,
          environment,
        },
      },
      select: { isActive: true },
    });

    return wallet?.isActive ?? false;
  }

  /**
   * Convert database record to WalletInfo
   */
  private toWalletInfo(wallet: {
    id: string;
    walletAddress: string;
    label: string;
    environment: string;
    isActive: boolean;
    lastUsedAt: Date | null;
    createdAt: Date;
    expiresAt: Date;
  }): WalletInfo {
    return {
      id: wallet.id,
      walletAddress: wallet.walletAddress,
      label: wallet.label,
      environment: wallet.environment as HyperliquidEnvironment,
      isActive: wallet.isActive,
      lastUsedAt: wallet.lastUsedAt,
      createdAt: wallet.createdAt,
      expiresAt: wallet.expiresAt,
    };
  }
}
