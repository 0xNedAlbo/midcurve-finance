/**
 * User Service
 *
 * Provides CRUD operations for the User model.
 * Simple service for user identification and management.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { User } from '@midcurve/database';
import type { CreateUserInput, UpdateUserInput } from '../types/user/index.js';

/**
 * User Service
 *
 * Handles all user-related database operations.
 */
export class UserService {
  private readonly prisma: PrismaClient;

  /**
   * Creates a new UserService instance
   *
   * @param dependencies - Service dependencies
   * @param dependencies.prisma - Prisma client instance (optional, defaults to new PrismaClient)
   */
  constructor(dependencies: { prisma?: PrismaClient } = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
  }

  /**
   * Creates a new user
   *
   * @param input - User creation input
   * @returns The created user
   *
   * @example
   * ```typescript
   * const user = await userService.create({
   *   name: 'Alice'
   * });
   * ```
   */
  async create(input: CreateUserInput): Promise<User> {
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
      },
    });

    return user;
  }

  /**
   * Finds a user by ID
   *
   * @param id - User ID
   * @returns The user if found, null otherwise
   *
   * @example
   * ```typescript
   * const user = await userService.findById('user_123');
   * ```
   */
  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    return user;
  }

  /**
   * Finds a user by name
   *
   * @param name - User name (exact match)
   * @returns The user if found, null otherwise
   *
   * @example
   * ```typescript
   * const user = await userService.findByName('Alice');
   * ```
   */
  async findByName(name: string): Promise<User | null> {
    const user = await this.prisma.user.findFirst({
      where: { name },
    });

    return user;
  }

  /**
   * Updates a user
   *
   * @param id - User ID
   * @param input - User update input
   * @returns The updated user
   *
   * @example
   * ```typescript
   * const updated = await userService.update('user_123', {
   *   name: 'Alice Smith'
   * });
   * ```
   */
  async update(id: string, input: UpdateUserInput): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id },
      data: input,
    });

    return user;
  }

  /**
   * Deletes a user
   *
   * @param id - User ID
   * @returns The deleted user
   *
   * @example
   * ```typescript
   * await userService.delete('user_123');
   * ```
   */
  async delete(id: string): Promise<User> {
    const user = await this.prisma.user.delete({
      where: { id },
    });

    return user;
  }

  /**
   * Lists all users
   *
   * @returns Array of all users
   *
   * @example
   * ```typescript
   * const users = await userService.findAll();
   * ```
   */
  async findAll(): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }
}
