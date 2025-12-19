/**
 * AuthUserService
 *
 * Manages users and wallet addresses for authentication.
 * Handles user CRUD operations and wallet management across multiple EVM chains.
 */

import type { PrismaClient, User, AuthWalletAddress } from '@midcurve/database';
import { validateAndNormalizeAddress } from '../../utils/auth/index.js';
import type { CreateUserInput, UpdateUserInput } from '../types/auth/index.js';
import { prisma } from '@midcurve/database';

export interface AuthUserServiceDependencies {
  prisma?: PrismaClient;
}

export class AuthUserService {
  private readonly prisma: PrismaClient;

  constructor(dependencies: AuthUserServiceDependencies = {}) {
    // Use provided Prisma client or create new one
    // This allows dependency injection for testing
    this.prisma = dependencies.prisma ?? (prisma);
  }

  // ===========================================================================
  // User Methods
  // ===========================================================================

  /**
   * Find user by ID with relations
   *
   * @param userId - User ID
   * @returns User with wallet addresses, or null if not found
   */
  async findUserById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        walletAddresses: true,
      },
    });
  }

  /**
   * Find user by wallet address and chain ID
   *
   * @param address - Ethereum address (any case)
   * @param chainId - EVM chain ID
   * @returns User if wallet is registered, null otherwise
   */
  async findUserByWallet(address: string, chainId: number): Promise<User | null> {
    const normalizedAddress = validateAndNormalizeAddress(address);

    const wallet = await this.prisma.authWalletAddress.findUnique({
      where: {
        address_chainId: {
          address: normalizedAddress,
          chainId,
        },
      },
      include: { user: true },
    });

    return wallet?.user ?? null;
  }

  /**
   * Create new user, optionally with initial wallet
   *
   * @param data - User creation data
   * @returns Created user
   */
  async createUser(data: CreateUserInput): Promise<User> {
    const { walletAddress, walletChainId, ...userData } = data;

    // If wallet provided, create user + wallet in transaction
    if (walletAddress && walletChainId) {
      const normalizedAddress = validateAndNormalizeAddress(walletAddress);

      return this.prisma.user.create({
        data: {
          ...userData,
          walletAddresses: {
            create: {
              address: normalizedAddress,
              chainId: walletChainId,
              isPrimary: true,
            },
          },
        },
        include: {
          walletAddresses: true,
        },
      });
    }

    // Otherwise, create user only
    return this.prisma.user.create({
      data: userData,
    });
  }

  /**
   * Update user profile fields
   *
   * @param userId - User ID
   * @param data - Fields to update
   * @returns Updated user
   */
  async updateUser(userId: string, data: UpdateUserInput): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  // ===========================================================================
  // Wallet Methods
  // ===========================================================================

  /**
   * Find wallet by address and chain ID
   *
   * @param address - Ethereum address (any case)
   * @param chainId - EVM chain ID
   * @returns Wallet with user relation, or null if not found
   */
  async findWalletByAddress(address: string, chainId: number): Promise<AuthWalletAddress | null> {
    const normalizedAddress = validateAndNormalizeAddress(address);

    return this.prisma.authWalletAddress.findUnique({
      where: {
        address_chainId: {
          address: normalizedAddress,
          chainId,
        },
      },
      include: { user: true },
    });
  }

  /**
   * Create wallet for existing user
   *
   * @param userId - User ID
   * @param address - Ethereum address (any case)
   * @param chainId - EVM chain ID
   * @param isPrimary - Whether to set as primary wallet
   * @returns Created wallet
   */
  async createWallet(
    userId: string,
    address: string,
    chainId: number,
    isPrimary: boolean = false
  ): Promise<AuthWalletAddress> {
    const normalizedAddress = validateAndNormalizeAddress(address);

    // If setting as primary, unset other primary wallets
    if (isPrimary) {
      await this.prisma.authWalletAddress.updateMany({
        where: { userId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.authWalletAddress.create({
      data: {
        userId,
        address: normalizedAddress,
        chainId,
        isPrimary,
      },
    });
  }

  /**
   * Link additional wallet to user account
   *
   * @param userId - User ID
   * @param address - Ethereum address (any case)
   * @param chainId - EVM chain ID
   * @returns Created wallet
   * @throws Error if wallet already registered to any user
   */
  async linkWallet(userId: string, address: string, chainId: number): Promise<AuthWalletAddress> {
    const normalizedAddress = validateAndNormalizeAddress(address);

    // Check wallet not already registered
    const existing = await this.findWalletByAddress(normalizedAddress, chainId);
    if (existing) {
      throw new Error('Wallet already registered to a user');
    }

    // Create wallet (not primary)
    return this.createWallet(userId, normalizedAddress, chainId, false);
  }

  /**
   * Get all wallets for a user
   *
   * @param userId - User ID
   * @returns Array of wallets (primary first, then by creation date)
   */
  async getUserWallets(userId: string): Promise<AuthWalletAddress[]> {
    return this.prisma.authWalletAddress.findMany({
      where: { userId },
      orderBy: [
        { isPrimary: 'desc' }, // Primary first
        { createdAt: 'asc' }, // Then by creation date
      ],
    });
  }

  /**
   * Change which wallet is primary
   *
   * @param userId - User ID
   * @param walletId - Wallet ID to set as primary
   * @returns Updated wallet
   * @throws Error if wallet not found or doesn't belong to user
   */
  async setPrimaryWallet(userId: string, walletId: string): Promise<AuthWalletAddress> {
    // Verify wallet belongs to user
    const wallet = await this.prisma.authWalletAddress.findUnique({
      where: { id: walletId },
    });

    if (!wallet || wallet.userId !== userId) {
      throw new Error('Wallet not found or does not belong to user');
    }

    // Use transaction to ensure atomicity
    return this.prisma.$transaction(async (tx) => {
      // Unset all primary wallets for user
      await tx.authWalletAddress.updateMany({
        where: { userId },
        data: { isPrimary: false },
      });

      // Set target wallet as primary
      return tx.authWalletAddress.update({
        where: { id: walletId },
        data: { isPrimary: true },
      });
    });
  }

  /**
   * Check if wallet address is available for registration
   *
   * @param address - Ethereum address (any case)
   * @param chainId - EVM chain ID
   * @returns true if available, false if already registered
   */
  async isWalletAvailable(address: string, chainId: number): Promise<boolean> {
    const wallet = await this.findWalletByAddress(address, chainId);
    return wallet === null;
  }
}
