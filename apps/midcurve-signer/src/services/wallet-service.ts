/**
 * EVM Automation Wallet Service
 *
 * Manages the lifecycle of EVM automation wallets:
 * - Create wallets (KMS key generation + database record)
 * - Retrieve wallet information
 * - Update wallet status
 *
 * Each user can have ONE automation wallet per chain (enforced by database constraint).
 */

import { prisma, Prisma } from '../lib/prisma';
import { getSigner, type KmsWalletCreationResult } from '../lib/kms';
import { signerLogger, signerLog } from '../lib/logger';
import type { Address } from 'viem';

/**
 * Result from creating a new wallet
 */
export interface CreateWalletResult {
  id: string;
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
export interface WalletInfo {
  id: string;
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
export interface CreateWalletInput {
  userId: string;
  label: string;
}

/**
 * Service errors
 */
export class WalletServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'WalletServiceError';
  }
}

class WalletService {
  private readonly logger = signerLogger.child({ service: 'WalletService' });

  /**
   * Create a new automation wallet for a user
   *
   * This creates a KMS key and stores the wallet record in the database.
   * Each user can only have one automation wallet.
   *
   * @throws WalletServiceError if user already has a wallet or creation fails
   */
  async createWallet(input: CreateWalletInput): Promise<CreateWalletResult> {
    const { userId, label } = input;
    signerLog.methodEntry(this.logger, 'createWallet', { userId, label });

    try {
      // Check if user already has a wallet
      const existingWallet = await prisma.evmAutomationWallet.findFirst({
        where: { userId, isActive: true },
      });

      if (existingWallet) {
        throw new WalletServiceError(
          'User already has an automation wallet',
          'WALLET_EXISTS',
          409
        );
      }

      // Create KMS key
      const signer = getSigner();
      const kmsResult: KmsWalletCreationResult = await signer.createKey(
        `${userId}:${label}`
      );

      // Get provider type from signer
      const keyProvider = process.env.SIGNER_USE_LOCAL_KEYS === 'true'
        ? 'local-encrypted'
        : 'aws-kms';

      // Create database record
      const wallet = await prisma.evmAutomationWallet.create({
        data: {
          userId,
          walletAddress: kmsResult.walletAddress,
          label,
          kmsKeyId: kmsResult.keyId,
          keyProvider,
          isActive: true,
        },
      });

      this.logger.info({
        userId,
        walletAddress: wallet.walletAddress,
        msg: 'Automation wallet created',
      });

      signerLog.methodExit(this.logger, 'createWallet', {
        walletId: wallet.id,
        walletAddress: wallet.walletAddress,
      });

      return {
        id: wallet.id,
        userId: wallet.userId,
        walletAddress: wallet.walletAddress as Address,
        label: wallet.label,
        kmsKeyId: wallet.kmsKeyId,
        keyProvider: wallet.keyProvider,
        createdAt: wallet.createdAt,
      };
    } catch (error) {
      if (error instanceof WalletServiceError) {
        throw error;
      }

      // Handle Prisma unique constraint violation
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new WalletServiceError(
          'Wallet already exists for this user',
          'WALLET_EXISTS',
          409
        );
      }

      signerLog.methodError(this.logger, 'createWallet', error, { userId });
      throw new WalletServiceError(
        'Failed to create wallet',
        'CREATE_FAILED',
        500
      );
    }
  }

  /**
   * Get wallet by user ID
   */
  async getWalletByUserId(userId: string): Promise<WalletInfo | null> {
    signerLog.methodEntry(this.logger, 'getWalletByUserId', { userId });

    const wallet = await prisma.evmAutomationWallet.findFirst({
      where: { userId, isActive: true },
    });

    if (!wallet) {
      return null;
    }

    return {
      id: wallet.id,
      userId: wallet.userId,
      walletAddress: wallet.walletAddress as Address,
      label: wallet.label,
      keyProvider: wallet.keyProvider,
      isActive: wallet.isActive,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      lastUsedAt: wallet.lastUsedAt,
    };
  }

  /**
   * Get wallet by wallet address
   */
  async getWalletByAddress(walletAddress: Address): Promise<WalletInfo | null> {
    signerLog.methodEntry(this.logger, 'getWalletByAddress', { walletAddress });

    const wallet = await prisma.evmAutomationWallet.findFirst({
      where: {
        walletAddress: walletAddress.toLowerCase(),
        isActive: true,
      },
    });

    if (!wallet) {
      // Try case-insensitive search
      const walletCaseInsensitive = await prisma.evmAutomationWallet.findFirst({
        where: {
          isActive: true,
        },
      });

      // Manual case-insensitive check
      if (
        walletCaseInsensitive &&
        walletCaseInsensitive.walletAddress.toLowerCase() ===
          walletAddress.toLowerCase()
      ) {
        return {
          id: walletCaseInsensitive.id,
          userId: walletCaseInsensitive.userId,
          walletAddress: walletCaseInsensitive.walletAddress as Address,
          label: walletCaseInsensitive.label,
          keyProvider: walletCaseInsensitive.keyProvider,
          isActive: walletCaseInsensitive.isActive,
          createdAt: walletCaseInsensitive.createdAt,
          updatedAt: walletCaseInsensitive.updatedAt,
          lastUsedAt: walletCaseInsensitive.lastUsedAt,
        };
      }

      return null;
    }

    return {
      id: wallet.id,
      userId: wallet.userId,
      walletAddress: wallet.walletAddress as Address,
      label: wallet.label,
      keyProvider: wallet.keyProvider,
      isActive: wallet.isActive,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      lastUsedAt: wallet.lastUsedAt,
    };
  }

  /**
   * Get the KMS key ID for a wallet (internal use only)
   */
  async getKmsKeyId(userId: string): Promise<string | null> {
    const wallet = await prisma.evmAutomationWallet.findFirst({
      where: { userId, isActive: true },
      select: { kmsKeyId: true },
    });

    return wallet?.kmsKeyId ?? null;
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(userId: string): Promise<void> {
    await prisma.evmAutomationWallet.updateMany({
      where: { userId, isActive: true },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Deactivate a wallet (soft delete)
   */
  async deactivateWallet(userId: string): Promise<boolean> {
    signerLog.methodEntry(this.logger, 'deactivateWallet', { userId });

    const result = await prisma.evmAutomationWallet.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    if (result.count > 0) {
      this.logger.info({
        userId,
        msg: 'Automation wallet deactivated',
      });
      return true;
    }

    return false;
  }

  /**
   * Get and increment nonce for a wallet on a specific chain
   *
   * This is an atomic operation that:
   * 1. Creates a nonce record if it doesn't exist (starting at 0)
   * 2. Returns the current nonce value
   * 3. Increments the nonce for the next transaction
   *
   * @returns The nonce to use for the current transaction
   * @throws WalletServiceError if wallet not found or operation fails
   */
  async getAndIncrementNonce(userId: string, chainId: number): Promise<number> {
    signerLog.methodEntry(this.logger, 'getAndIncrementNonce', { userId, chainId });

    // First, get the wallet
    const wallet = await prisma.evmAutomationWallet.findFirst({
      where: { userId, isActive: true },
      select: { id: true },
    });

    if (!wallet) {
      throw new WalletServiceError(
        'User does not have an active automation wallet',
        'NO_WALLET',
        404
      );
    }

    // Use upsert to atomically get/create and then update the nonce
    // This uses PostgreSQL's INSERT ... ON CONFLICT for atomicity
    const nonceRecord = await prisma.evmAutomationWalletNonce.upsert({
      where: {
        walletId_chainId: {
          walletId: wallet.id,
          chainId,
        },
      },
      create: {
        walletId: wallet.id,
        chainId,
        nonce: 1, // Create with 1 because we're returning 0 as current nonce
      },
      update: {
        nonce: {
          increment: 1,
        },
      },
    });

    // The returned nonce is the NEW value after increment
    // So the nonce to use is (newValue - 1)
    const currentNonce = nonceRecord.nonce - 1;

    this.logger.debug({
      userId,
      chainId,
      nonce: currentNonce,
      msg: 'Nonce retrieved and incremented',
    });

    signerLog.methodExit(this.logger, 'getAndIncrementNonce', { nonce: currentNonce });

    return currentNonce;
  }

  /**
   * Get current nonce without incrementing (for read-only queries)
   *
   * @returns Current nonce value, or 0 if no transactions have been made on this chain
   */
  async getCurrentNonce(userId: string, chainId: number): Promise<number> {
    signerLog.methodEntry(this.logger, 'getCurrentNonce', { userId, chainId });

    const wallet = await prisma.evmAutomationWallet.findFirst({
      where: { userId, isActive: true },
      select: { id: true },
    });

    if (!wallet) {
      throw new WalletServiceError(
        'User does not have an active automation wallet',
        'NO_WALLET',
        404
      );
    }

    const nonceRecord = await prisma.evmAutomationWalletNonce.findUnique({
      where: {
        walletId_chainId: {
          walletId: wallet.id,
          chainId,
        },
      },
    });

    return nonceRecord?.nonce ?? 0;
  }

  /**
   * Reset nonce to a specific value (for recovery scenarios)
   *
   * Use this when the on-chain nonce gets out of sync with the database,
   * for example after a failed transaction that was never broadcast.
   *
   * @param nonce The nonce value to set (typically from eth_getTransactionCount)
   */
  async resetNonce(userId: string, chainId: number, nonce: number): Promise<void> {
    signerLog.methodEntry(this.logger, 'resetNonce', { userId, chainId, nonce });

    const wallet = await prisma.evmAutomationWallet.findFirst({
      where: { userId, isActive: true },
      select: { id: true },
    });

    if (!wallet) {
      throw new WalletServiceError(
        'User does not have an active automation wallet',
        'NO_WALLET',
        404
      );
    }

    await prisma.evmAutomationWalletNonce.upsert({
      where: {
        walletId_chainId: {
          walletId: wallet.id,
          chainId,
        },
      },
      create: {
        walletId: wallet.id,
        chainId,
        nonce,
      },
      update: {
        nonce,
      },
    });

    this.logger.info({
      userId,
      chainId,
      nonce,
      msg: 'Nonce reset to specified value',
    });

    signerLog.methodExit(this.logger, 'resetNonce', { nonce });
  }
}

// Export singleton instance
export const walletService = new WalletService();
