/**
 * AuthApiKeyService
 *
 * Manages API keys for programmatic access.
 * Handles key generation, validation, and revocation.
 *
 * SECURITY:
 * - API keys are hashed with SHA-256 before storage
 * - Full key is only returned at creation time
 * - Key hashes are never exposed
 */

import type { PrismaClient, ApiKey } from '@midcurve/database';
import { createHash } from 'crypto';
import { customAlphabet } from 'nanoid';
import type { ApiKeyCreationResult } from '../types/auth/index.js';
import { prisma } from '@midcurve/database';

export interface AuthApiKeyServiceDependencies {
  prisma?: PrismaClient;
}

export class AuthApiKeyService {
  private readonly prisma: PrismaClient;

  constructor(dependencies: AuthApiKeyServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? (prisma);
  }

  /**
   * Create new API key for user
   *
   * @param userId - User ID
   * @param name - User-friendly name for the key
   * @returns API key record and full plaintext key
   *
   * IMPORTANT: This is the ONLY time the full key is returned.
   * It cannot be recovered later.
   */
  async createApiKey(userId: string, name: string): Promise<ApiKeyCreationResult> {
    // Generate API key
    const key = this.generateKey();
    const keyHash = this.hashKey(key);
    const keyPrefix = key.slice(0, 8); // "mc_live_"

    // Store in database
    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        name,
        keyHash,
        keyPrefix,
      },
    });

    // Return both DB record and full key
    return { apiKey, key };
  }

  /**
   * Validate API key and return associated data
   *
   * @param key - Full API key (mc_live_...)
   * @returns API key record with user and wallets, or null if invalid
   */
  async validateApiKey(key: string): Promise<ApiKey | null> {
    const keyHash = this.hashKey(key);

    return this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        user: {
          include: {
            walletAddresses: true,
          },
        },
      },
    });
  }

  /**
   * List user's API keys (without hashes or full keys)
   *
   * @param userId - User ID
   * @returns Array of API key display info
   */
  async getUserApiKeys(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      keyPrefix: string;
      lastUsed: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    return this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true, // ONLY show prefix
        lastUsed: true,
        createdAt: true,
        updatedAt: true,
        // Do NOT include keyHash or full key
      },
    });
  }

  /**
   * Revoke (delete) an API key
   *
   * @param userId - User ID (for ownership verification)
   * @param keyId - API key ID
   * @throws Error if key not found or doesn't belong to user
   */
  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    // Verify key belongs to user before deleting
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!apiKey || apiKey.userId !== userId) {
      throw new Error('API key not found or does not belong to user');
    }

    await this.prisma.apiKey.delete({
      where: { id: keyId },
    });
  }

  /**
   * Update lastUsed timestamp when key is used
   *
   * Fire-and-forget update (async, don't block auth flow)
   *
   * @param keyId - API key ID
   */
  async updateLastUsed(keyId: string): Promise<void> {
    // Fire-and-forget update (don't await in auth flow)
    this.prisma.apiKey
      .update({
        where: { id: keyId },
        data: { lastUsed: new Date() },
      })
      .catch((err) => {
        console.error('Failed to update API key lastUsed:', err);
      });
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Generate new API key
   *
   * Format: mc_live_{32_char_random_string}
   *
   * @returns Generated API key
   */
  private generateKey(): string {
    // Use custom alphabet for base62 encoding
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const nanoid = customAlphabet(alphabet, 32);

    return `mc_live_${nanoid()}`;
  }

  /**
   * Hash API key with SHA-256
   *
   * @param key - API key to hash
   * @returns SHA-256 hash (hex string)
   */
  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }
}
