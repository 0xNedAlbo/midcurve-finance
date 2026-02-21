/**
 * Uniswap V3 Quote Token Service
 *
 * Determines quote token for Uniswap V3 pools based on:
 * 1. Default preferences for chain (stablecoins > WETH > token0)
 * 2. Fallback: token0 (Uniswap convention)
 */

import { QuoteTokenService } from './quote-token-service.js';
import type { QuoteTokenResult, QuoteTokenResultProtocol } from '@midcurve/shared';
import type { UniswapV3QuoteTokenInput } from '../types/quote-token/quote-token-input.js';
import { normalizeAddress } from '@midcurve/shared';
import { getDefaultQuoteTokens } from '../../config/quote-tokens.js';
import { log } from '../../logging/index.js';

/**
 * UniswapV3QuoteTokenService
 *
 * Determines quote token for Uniswap V3 pools based on:
 * 1. Default preferences for chain (stablecoins > WETH > token0)
 * 2. Fallback: token0 (Uniswap convention)
 */
export class UniswapV3QuoteTokenService extends QuoteTokenService {
  protected readonly protocol: QuoteTokenResultProtocol = 'uniswapv3';

  /**
   * Determine quote token for a Uniswap V3 pool
   *
   * @param input - Quote token determination input
   * @returns Quote token determination result
   */
  async determineQuoteToken(
    input: UniswapV3QuoteTokenInput
  ): Promise<QuoteTokenResult> {
    const { chainId, token0Address, token1Address } = input;

    log.methodEntry(this.logger, 'determineQuoteToken', {
      chainId,
      token0Address,
      token1Address,
    });

    try {
      // Normalize addresses
      const token0 = this.normalizeTokenId(token0Address);
      const token1 = this.normalizeTokenId(token1Address);

      // 1. Chain-specific defaults (stablecoins > WETH)
      const defaults = this.getDefaultQuoteTokensForChain(chainId);
      const result = this.matchTokensAgainstDefaults(token0, token1, defaults);
      if (result) {
        log.methodExit(this.logger, 'determineQuoteToken', {
          matchedBy: 'default',
        });
        return { ...result, matchedBy: 'default', protocol: 'uniswapv3' };
      }

      // 2. Ultimate fallback: token0 is quote (Uniswap convention)
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
        chainId,
        token0Address,
        token1Address,
      });
      throw error;
    }
  }

  /**
   * Get default quote tokens (global defaults, not chain-specific)
   * Used when chain-specific defaults don't match
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
   * Match tokens against default quote token list
   * Returns result if match found, null otherwise
   *
   * Matching logic:
   * 1. Only one token matches → that's the quote token
   * 2. Both tokens match → use list order (first in list wins)
   * 3. Neither matches → return null
   *
   * @param token0 - Normalized token0 address
   * @param token1 - Normalized token1 address
   * @param defaults - Ordered list of default quote token addresses
   * @returns Quote token result (without matchedBy and protocol), or null
   */
  private matchTokensAgainstDefaults(
    token0: string,
    token1: string,
    defaults: string[]
  ): Omit<QuoteTokenResult, 'matchedBy' | 'protocol'> | null {
    const token0Matches = defaults.some((pref) =>
      this.compareTokenIds(pref, token0)
    );
    const token1Matches = defaults.some((pref) =>
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

    // Both match - use list order: first token in defaults list wins
    if (token0Matches && token1Matches) {
      const token0Index = defaults.findIndex((pref) =>
        this.compareTokenIds(pref, token0)
      );
      const token1Index = defaults.findIndex((pref) =>
        this.compareTokenIds(pref, token1)
      );

      return token0Index < token1Index
        ? { isToken0Quote: true, quoteTokenId: token0, baseTokenId: token1 }
        : { isToken0Quote: false, quoteTokenId: token1, baseTokenId: token0 };
    }

    return null; // Neither matches
  }
}
