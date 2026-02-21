/**
 * Quote Token Service
 *
 * Abstract base class for protocol-specific quote token determination services.
 * Handles default configurations and fallback logic.
 */

import type { QuoteTokenResult, QuoteTokenResultProtocol } from '@midcurve/shared';
import type { QuoteTokenInput } from '../types/quote-token/quote-token-input.js';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Abstract QuoteTokenService
 *
 * Base class for protocol-specific quote token determination services.
 * Uses chain-specific default configurations with token0 fallback.
 */
export abstract class QuoteTokenService {
  protected readonly logger: ServiceLogger;
  protected abstract readonly protocol: QuoteTokenResultProtocol;

  constructor() {
    this.logger = createServiceLogger(this.constructor.name);
    this.logger.info('QuoteTokenService initialized');
  }

  // ============================================================================
  // ABSTRACT METHODS
  // Protocol implementations MUST implement these methods
  // ============================================================================

  /**
   * Determine quote token for a token pair based on chain defaults
   *
   * Implementation flow:
   * 1. Match tokens against chain-specific defaults (stablecoins > WETH)
   * 2. Fallback: token0 as quote (convention)
   *
   * @param input - Quote token determination input (protocol-specific)
   * @returns Quote token determination result
   */
  abstract determineQuoteToken(input: QuoteTokenInput): Promise<QuoteTokenResult>;

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
}
