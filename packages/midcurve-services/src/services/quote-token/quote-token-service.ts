/**
 * Quote Token Service
 *
 * Abstract base class for protocol-specific quote token determination services.
 * Handles user preferences, default configurations, and fallback logic.
 */

import { PrismaClient } from '@midcurve/database';
import type { PoolConfigMap } from '@midcurve/shared';
import type { QuoteTokenResult } from '@midcurve/shared';
import type { QuoteTokenInput } from '../types/quote-token/quote-token-input.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Dependencies for QuoteTokenService
 */
export interface QuoteTokenServiceDependencies {
  prisma?: PrismaClient;
}

/**
 * Abstract QuoteTokenService
 *
 * Base class for protocol-specific quote token determination services.
 * Handles user preferences, default configurations, and fallback logic.
 *
 * @template P - Protocol key from PoolConfigMap ('uniswapv3', etc.)
 */
export abstract class QuoteTokenService<P extends keyof PoolConfigMap> {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;

  constructor(dependencies: QuoteTokenServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger(this.constructor.name);
    this.logger.info('QuoteTokenService initialized');
  }

  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  // ============================================================================
  // ABSTRACT METHODS
  // Protocol implementations MUST implement these methods
  // ============================================================================

  /**
   * Determine quote token for a token pair based on user preferences
   *
   * Implementation flow:
   * 1. Load user preferences from database (if exists)
   * 2. Match tokens against preferences (protocol-specific matching logic)
   * 3. Fall back to default preferences if no user preferences
   * 4. Ultimate fallback: token0 as quote (convention)
   *
   * @param input - Quote token determination input (protocol-specific)
   * @returns Quote token determination result
   */
  abstract determineQuoteToken(
    input: QuoteTokenInput<P>
  ): Promise<QuoteTokenResult<P>>;

  /**
   * Get default quote token identifiers for this protocol
   *
   * Protocol-specific implementation returns ordered list of token identifiers:
   * - EVM: Normalized addresses (0x...)
   * - Solana: Mint addresses (base58)
   *
   * First match wins when matching against token pairs.
   *
   * @returns Ordered list of default quote token identifiers
   */
  abstract getDefaultQuoteTokens(): string[];

  /**
   * Normalize token identifier to canonical form
   *
   * Protocol-specific normalization:
   * - EVM: Convert to EIP-55 checksum address
   * - Solana: Validate base58 format
   *
   * @param tokenId - Raw token identifier
   * @returns Normalized token identifier
   * @throws Error if invalid format
   */
  abstract normalizeTokenId(tokenId: string): string;

  /**
   * Compare two token identifiers for equality
   *
   * Protocol-specific comparison (case-insensitive, normalized):
   * - EVM: Compare normalized addresses
   * - Solana: Compare base58 strings
   *
   * @param tokenIdA - First token identifier
   * @param tokenIdB - Second token identifier
   * @returns true if equal, false otherwise
   */
  abstract compareTokenIds(tokenIdA: string, tokenIdB: string): boolean;

  // ============================================================================
  // SHARED METHODS
  // Common logic shared across all protocols
  // ============================================================================

  /**
   * Set user's preferred quote tokens for this protocol
   *
   * @param userId - User ID
   * @param preferredQuoteTokens - Ordered list of token identifiers (protocol-specific)
   */
  async setUserPreferences(
    userId: string,
    preferredQuoteTokens: string[]
  ): Promise<void> {
    log.methodEntry(this.logger, 'setUserPreferences', {
      userId,
      count: preferredQuoteTokens.length,
    });

    try {
      // Normalize all token identifiers
      const normalized = preferredQuoteTokens.map((token) =>
        this.normalizeTokenId(token)
      );

      await this.prisma.userQuoteTokenPreference.upsert({
        where: {
          userId_protocol: {
            userId,
            protocol: this.getProtocol(),
          },
        },
        update: {
          preferredQuoteTokens: normalized,
        },
        create: {
          userId,
          protocol: this.getProtocol(),
          preferredQuoteTokens: normalized,
        },
      });

      log.methodExit(this.logger, 'setUserPreferences', { userId });
    } catch (error) {
      log.methodError(this.logger, 'setUserPreferences', error as Error, {
        userId,
      });
      throw error;
    }
  }

  /**
   * Get user's current preferences for this protocol
   * Returns null if no preferences set
   *
   * @param userId - User ID
   * @returns Array of preferred quote token IDs, or null if not set
   */
  async getUserPreferences(userId: string): Promise<string[] | null> {
    const prefs = await this.prisma.userQuoteTokenPreference.findUnique({
      where: {
        userId_protocol: {
          userId,
          protocol: this.getProtocol(),
        },
      },
    });

    return prefs ? (prefs.preferredQuoteTokens as string[]) : null;
  }

  /**
   * Reset user preferences to defaults
   *
   * @param userId - User ID
   */
  async resetToDefaults(userId: string): Promise<void> {
    log.methodEntry(this.logger, 'resetToDefaults', { userId });

    try {
      await this.prisma.userQuoteTokenPreference.delete({
        where: {
          userId_protocol: {
            userId,
            protocol: this.getProtocol(),
          },
        },
      });

      log.methodExit(this.logger, 'resetToDefaults', { userId });
    } catch (error) {
      // If not found, that's okay - already at defaults
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2025'
      ) {
        this.logger.debug({ userId }, 'No preferences to reset');
        return;
      }

      log.methodError(this.logger, 'resetToDefaults', error as Error, {
        userId,
      });
      throw error;
    }
  }

  /**
   * Get protocol identifier for this service
   * Implemented by concrete classes
   *
   * @returns Protocol identifier
   */
  protected abstract getProtocol(): P;
}
