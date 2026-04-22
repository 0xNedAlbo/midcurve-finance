/**
 * ApiKeyService
 *
 * Manages long-lived personal access tokens (API keys) for programmatic API access.
 * Keys are stored as SHA-256 hashes; the raw key is shown to the user only once at
 * creation time. Validation hashes the incoming key and looks it up by hash.
 *
 * SECURITY:
 * - Keys are 32 random bytes (256 bits) prefixed with "mck_" (base64url encoded)
 * - Only the SHA-256 hash is persisted; raw keys are unrecoverable
 * - keyPrefix (first 12 chars of the raw key) is stored separately for display
 * - Optional expiry; revocation is hard-delete
 */

import { createHash, randomBytes } from 'node:crypto';
import type { ApiKey, PrismaClient } from '@midcurve/database';
import { prisma } from '@midcurve/database';

export interface ApiKeyServiceDependencies {
  prisma?: PrismaClient;
}

export interface ApiKeyValidation {
  userId: string;
  keyId: string;
}

export interface CreatedApiKey {
  id: string;
  key: string; // Raw key — returned ONLY at creation, never persisted
  keyPrefix: string;
  name: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export type ApiKeyRecord = Omit<ApiKey, 'keyHash'>;

const API_KEY_PREFIX = 'mck_';
const API_KEY_BYTES = 32;
const KEY_PREFIX_DISPLAY_LENGTH = 12;

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function generateRawKey(): string {
  const random = randomBytes(API_KEY_BYTES).toString('base64url');
  return `${API_KEY_PREFIX}${random}`;
}

export class ApiKeyService {
  private readonly prisma: PrismaClient;

  constructor(dependencies: ApiKeyServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prisma;
  }

  /**
   * Create new API key for user. Returns the raw key once; it cannot be retrieved later.
   *
   * @param userId - Owner of the key
   * @param name - User-assigned label
   * @param expiresAt - Optional expiry date (null = no expiry)
   */
  async createKey(
    userId: string,
    name: string,
    expiresAt?: Date | null
  ): Promise<CreatedApiKey> {
    const rawKey = generateRawKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, KEY_PREFIX_DISPLAY_LENGTH);

    const created = await this.prisma.apiKey.create({
      data: {
        userId,
        name,
        keyHash,
        keyPrefix,
        expiresAt: expiresAt ?? null,
      },
    });

    return {
      id: created.id,
      key: rawKey,
      keyPrefix: created.keyPrefix,
      name: created.name,
      createdAt: created.createdAt,
      expiresAt: created.expiresAt,
    };
  }

  /**
   * Validate an incoming API key. Returns null if not found, expired, or malformed.
   * Updates lastUsedAt fire-and-forget.
   */
  async validateKey(rawKey: string): Promise<ApiKeyValidation | null> {
    if (!rawKey.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const keyHash = hashKey(rawKey);
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: { id: true, userId: true, expiresAt: true },
    });

    if (!record) {
      return null;
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      return null;
    }

    this.prisma.apiKey
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Ignore — usage timestamp is non-critical
      });

    return { userId: record.userId, keyId: record.id };
  }

  /**
   * List all API keys for a user, sorted by creation date (newest first).
   * Excludes the keyHash field — only display-safe data is returned.
   */
  async listUserKeys(userId: string): Promise<ApiKeyRecord[]> {
    return this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        keyPrefix: true,
        userId: true,
        name: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
    });
  }

  /**
   * Revoke (delete) a key. Returns true if a key was deleted, false if not found
   * or owned by a different user.
   */
  async revokeKey(userId: string, keyId: string): Promise<boolean> {
    const result = await this.prisma.apiKey.deleteMany({
      where: { id: keyId, userId },
    });
    return result.count > 0;
  }
}
