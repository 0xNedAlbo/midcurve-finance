/**
 * User Wallet Service
 *
 * CRUD operations for user-owned wallets.
 * Manages the wallet perimeter — which wallets belong to a user.
 */

import { prisma as prismaClient, Prisma, type PrismaClient } from '@midcurve/database';
import type { UserWallet } from '@midcurve/database';
import { normalizeAddress } from '@midcurve/shared';
import type {
  CreateUserWalletInput,
  UpdateUserWalletInput,
} from '../types/wallet-perimeter/index.js';

export class UserWalletService {
  private readonly prisma: PrismaClient;

  constructor(dependencies: { prisma?: PrismaClient } = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
  }

  /**
   * Build walletHash and config from walletType and raw address.
   * EVM: normalizes address to EIP-55 checksum.
   */
  private buildWalletData(walletType: string, address: string): { walletHash: string; config: Record<string, unknown> } {
    switch (walletType) {
      case 'evm': {
        const normalized = normalizeAddress(address);
        return {
          walletHash: `evm/${normalized}`,
          config: { address: normalized },
        };
      }
      case 'solana':
        return {
          walletHash: `solana/${address}`,
          config: { address },
        };
      case 'bitcoin':
        return {
          walletHash: `bitcoin/${address}`,
          config: { address },
        };
      default:
        throw new Error(`Unsupported wallet type: ${walletType}`);
    }
  }

  async create(input: CreateUserWalletInput): Promise<UserWallet> {
    const { walletHash, config } = this.buildWalletData(input.walletType, input.address);

    return this.prisma.userWallet.create({
      data: {
        userId: input.userId,
        walletType: input.walletType,
        walletHash,
        label: input.label,
        config: config as unknown as Prisma.InputJsonValue,
        isPrimary: input.isPrimary ?? false,
      },
    });
  }

  async findById(id: string): Promise<UserWallet | null> {
    return this.prisma.userWallet.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<UserWallet[]> {
    return this.prisma.userWallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByWalletHash(walletHash: string): Promise<UserWallet | null> {
    return this.prisma.userWallet.findUnique({ where: { walletHash } });
  }

  /**
   * Find a user wallet by type and address.
   * Normalizes the address before lookup.
   */
  async findByTypeAndAddress(walletType: string, address: string): Promise<UserWallet | null> {
    const { walletHash } = this.buildWalletData(walletType, address);
    return this.prisma.userWallet.findUnique({ where: { walletHash } });
  }

  /**
   * Check if an address belongs to a specific user.
   */
  async isUserWallet(userId: string, walletType: string, address: string): Promise<boolean> {
    const { walletHash } = this.buildWalletData(walletType, address);
    const wallet = await this.prisma.userWallet.findFirst({
      where: { userId, walletHash },
      select: { id: true },
    });
    return wallet !== null;
  }

  async update(id: string, input: UpdateUserWalletInput): Promise<UserWallet> {
    return this.prisma.userWallet.update({
      where: { id },
      data: input,
    });
  }

  async delete(id: string): Promise<UserWallet> {
    return this.prisma.userWallet.delete({ where: { id } });
  }
}
