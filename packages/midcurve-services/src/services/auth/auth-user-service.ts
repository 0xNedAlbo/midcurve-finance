/**
 * AuthUserService
 *
 * Manages users for authentication.
 * Chain-agnostic: the same EVM address is recognized as the same user regardless of chain.
 */

import type { PrismaClient, User } from '@midcurve/database';
import { validateAndNormalizeAddress } from '../../utils/auth/index.js';
import type { CreateUserInput, UpdateUserInput } from '../types/auth/index.js';
import { prisma } from '@midcurve/database';

export interface AuthUserServiceDependencies {
  prisma?: PrismaClient;
}

export class AuthUserService {
  private readonly prisma: PrismaClient;

  constructor(dependencies: AuthUserServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? (prisma);
  }

  /**
   * Find user by ID
   */
  async findUserById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }

  /**
   * Find user by wallet address (chain-agnostic)
   */
  async findUserByWallet(address: string): Promise<User | null> {
    const normalizedAddress = validateAndNormalizeAddress(address);

    return this.prisma.user.findUnique({
      where: { address: normalizedAddress },
    });
  }

  /**
   * Create new user with wallet address
   */
  async createUser(data: CreateUserInput): Promise<User> {
    const { address, ...userData } = data;
    const normalizedAddress = validateAndNormalizeAddress(address);

    return this.prisma.user.create({
      data: {
        ...userData,
        address: normalizedAddress,
      },
    });
  }

  /**
   * Update user profile fields
   */
  async updateUser(userId: string, data: UpdateUserInput): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }
}
