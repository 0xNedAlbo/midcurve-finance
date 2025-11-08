/**
 * Uniswap V3 Quote Token Service
 *
 * Determines quote token for Uniswap V3 pools based on:
 * 1. User preferences (stored in database)
 * 2. Default preferences for chain (stablecoins > WETH > token0)
 * 3. Fallback: token0 (Uniswap convention)
 */

import { QuoteTokenService } from './quote-token-service.js';
import type { QuoteTokenResult } from '@midcurve/shared';
import type { UniswapV3QuoteTokenInput } from '../types/quote-token/quote-token-input.js';
import { normalizeAddress } from '@midcurve/shared';
import { getDefaultQuoteTokens } from '../../config/quote-tokens.js';
import { log } from '../../logging/index.js';

/**
 * UniswapV3QuoteTokenService
 *
 * Determines quote token for Uniswap V3 pools based on:
 * 1. User preferences (stored in database)
 * 2. Default preferences for chain (stablecoins > WETH > token0)
 * 3. Fallback: token0 (Uniswap convention)
 */
export class UniswapV3QuoteTokenService extends QuoteTokenService<'uniswapv3'> {
  /**
   * Determine quote token for a Uniswap V3 pool
   *
   * @param input - Quote token determination input
   * @returns Quote token determination result
   */
  async determineQuoteToken(
    input: UniswapV3QuoteTokenInput
  ): Promise<QuoteTokenResult<'uniswapv3'>> {
    const { userId, chainId, token0Address, token1Address } = input;

    log.methodEntry(this.logger, 'determineQuoteToken', {
      userId,
      chainId,
      token0Address,
      token1Address,
    });

    try {
      // Normalize addresses
      const token0 = this.normalizeTokenId(token0Address);
      const token1 = this.normalizeTokenId(token1Address);

      // 1. Try user preferences first
      const userPrefs = await this.getUserPreferences(userId);
      if (userPrefs && userPrefs.length > 0) {
        const result = this.matchTokensAgainstPreferences(
          token0,
          token1,
          userPrefs
        );
        if (result) {
          log.methodExit(this.logger, 'determineQuoteToken', {
            matchedBy: 'user_preference',
          });
          return {
            ...result,
            matchedBy: 'user_preference',
            protocol: 'uniswapv3',
          };
        }
      }

      // 2. Fall back to default preferences for this chain
      const defaults = this.getDefaultQuoteTokensForChain(chainId);
      const result = this.matchTokensAgainstPreferences(token0, token1, defaults);
      if (result) {
        log.methodExit(this.logger, 'determineQuoteToken', {
          matchedBy: 'default',
        });
        return { ...result, matchedBy: 'default', protocol: 'uniswapv3' };
      }

      // 3. Ultimate fallback: token0 is quote (Uniswap convention)
      this.logger.debug(
        { token0, token1 },
        'No matches found, using token0 as quote (fallback)'
      );
      log.methodExit(this.logger, 'determineQuoteToken', {
        matchedBy: 'fallback',
      });
      return {
        isToken0Quote: true,
        quoteTokenId: token0,
        baseTokenId: token1,
        matchedBy: 'fallback',
        protocol: 'uniswapv3',
      };
    } catch (error) {
      log.methodError(this.logger, 'determineQuoteToken', error as Error, {
        userId,
        chainId,
        token0Address,
        token1Address,
      });
      throw error;
    }
  }

  /**
   * Get default quote tokens (global defaults, not chain-specific)
   * Used when user has no preferences and chain-specific defaults don't match
   *
   * @returns Empty array (chain-specific defaults are primary)
   */
  getDefaultQuoteTokens(): string[] {
    // This is a fallback - actual defaults are chain-specific
    return [];
  }

  /**
   * Get default quote tokens for a specific chain
   *
   * @param chainId - EVM chain ID
   * @returns Ordered list of default quote token addresses
   */
  private getDefaultQuoteTokensForChain(chainId: number): string[] {
    const defaults = getDefaultQuoteTokens(chainId);
    if (!defaults || defaults.length === 0) {
      this.logger.warn(
        { chainId },
        'No default quote tokens for chain, using empty list'
      );
      return [];
    }
    return defaults;
  }

  /**
   * Normalize EVM address to EIP-55 checksum format
   *
   * @param tokenId - Raw EVM address
   * @returns Normalized address
   * @throws Error if invalid address format
   */
  normalizeTokenId(tokenId: string): string {
    return normalizeAddress(tokenId);
  }

  /**
   * Compare two EVM addresses for equality (case-insensitive)
   *
   * @param tokenIdA - First address
   * @param tokenIdB - Second address
   * @returns true if addresses are equal (case-insensitive)
   */
  compareTokenIds(tokenIdA: string, tokenIdB: string): boolean {
    try {
      const normalizedA = this.normalizeTokenId(tokenIdA);
      const normalizedB = this.normalizeTokenId(tokenIdB);
      return normalizedA === normalizedB;
    } catch {
      return false;
    }
  }

  /**
   * Get protocol identifier
   *
   * @returns Protocol identifier 'uniswapv3'
   */
  protected getProtocol(): 'uniswapv3' {
    return 'uniswapv3';
  }

  /**
   * Match tokens against preference list
   * Returns result if match found, null otherwise
   *
   * Matching logic:
   * 1. Only one token matches → that's the quote token
   * 2. Both tokens match → use list order (first in list wins)
   * 3. Neither matches → return null
   *
   * @param token0 - Normalized token0 address
   * @param token1 - Normalized token1 address
   * @param preferences - Ordered list of preferred quote token addresses
   * @returns Quote token result (without matchedBy and protocol), or null
   */
  private matchTokensAgainstPreferences(
    token0: string,
    token1: string,
    preferences: string[]
  ): Omit<QuoteTokenResult<'uniswapv3'>, 'matchedBy' | 'protocol'> | null {
    const token0Matches = preferences.some((pref) =>
      this.compareTokenIds(pref, token0)
    );
    const token1Matches = preferences.some((pref) =>
      this.compareTokenIds(pref, token1)
    );

    // Only one matches - that's the quote token
    if (token0Matches && !token1Matches) {
      return {
        isToken0Quote: true,
        quoteTokenId: token0,
        baseTokenId: token1,
      };
    }

    if (token1Matches && !token0Matches) {
      return {
        isToken0Quote: false,
        quoteTokenId: token1,
        baseTokenId: token0,
      };
    }

    // Both match - use list order: first token in preferences list wins
    if (token0Matches && token1Matches) {
      const token0Index = preferences.findIndex((pref) =>
        this.compareTokenIds(pref, token0)
      );
      const token1Index = preferences.findIndex((pref) =>
        this.compareTokenIds(pref, token1)
      );

      return token0Index < token1Index
        ? { isToken0Quote: true, quoteTokenId: token0, baseTokenId: token1 }
        : { isToken0Quote: false, quoteTokenId: token1, baseTokenId: token0 };
    }

    return null; // Neither matches
  }
}
