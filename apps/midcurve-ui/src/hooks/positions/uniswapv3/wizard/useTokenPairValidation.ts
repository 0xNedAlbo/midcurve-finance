/**
 * Token Pair Validation Hook
 *
 * Validates that base and quote tokens are different and suitable for a position.
 */

import { useMemo } from 'react';
import { areAddressesEqual } from '@/utils/evm';
import type { TokenSearchResult } from './useTokenSearch';

export interface TokenPairValidation {
  isValid: boolean;
  error: string | null;
}

/**
 * Validate a token pair for position creation
 *
 * Rules:
 * - Both tokens must be present
 * - Base and quote tokens must be different (by address)
 *
 * @param baseToken - Selected base token
 * @param quoteToken - Selected quote token
 * @returns Validation result with error message if invalid
 */
export function useTokenPairValidation(
  baseToken: TokenSearchResult | null,
  quoteToken: TokenSearchResult | null
): TokenPairValidation {
  return useMemo(() => {
    // If either token is missing, no validation needed (not ready to validate)
    if (!baseToken || !quoteToken) {
      return { isValid: false, error: null };
    }

    // Check if base and quote tokens are the same
    if (areAddressesEqual(baseToken.address, quoteToken.address)) {
      return {
        isValid: false,
        error: 'Base and quote tokens must be different',
      };
    }

    // All checks passed
    return { isValid: true, error: null };
  }, [baseToken, quoteToken]);
}
