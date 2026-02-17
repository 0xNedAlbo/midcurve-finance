/**
 * Close Order Hash Utilities
 *
 * Provides functions for deriving, parsing, and validating close order hash identifiers.
 * Format: "{sl|tp}@{tick}" where:
 * - sl = Stop Loss (TriggerMode.LOWER)
 * - tp = Take Profit (TriggerMode.UPPER)
 * - tick = Integer tick derived from sqrtPriceX96
 */

import { type TriggerMode, ContractTriggerMode, sqrtPriceX96ToTick } from '@midcurve/shared';

/**
 * Close order type prefix
 */
export type CloseOrderHashType = 'sl' | 'tp';

/**
 * Parsed components of a close order hash
 */
export interface CloseOrderHashComponents {
  type: CloseOrderHashType;
  tick: number;
}

/**
 * Regular expression for validating close order hash format
 * Matches: "sl@{tick}" or "tp@{tick}" where tick is an integer (positive or negative)
 */
const CLOSE_ORDER_HASH_REGEX = /^(sl|tp)@(-?\d+)$/;

/**
 * Derives a close order hash from trigger mode and sqrtPriceX96
 *
 * @param triggerMode - The trigger mode (LOWER or UPPER)
 * @param sqrtPriceX96Trigger - The sqrtPriceX96 threshold that triggers the close
 * @returns Close order hash in format "{sl|tp}@{tick}"
 */
export function deriveCloseOrderHash(
  triggerMode: TriggerMode,
  sqrtPriceX96Trigger: bigint
): string {
  const tick = sqrtPriceX96ToTick(sqrtPriceX96Trigger);

  if (triggerMode === 'LOWER') {
    return `sl@${tick}`;
  } else {
    return `tp@${tick}`;
  }
}

/**
 * Derives a close order hash from trigger mode and config's sqrtPriceX96 thresholds
 *
 * @param triggerMode - The trigger mode (LOWER or UPPER)
 * @param sqrtPriceX96Lower - Lower price threshold (used for LOWER trigger)
 * @param sqrtPriceX96Upper - Upper price threshold (used for UPPER trigger)
 * @returns Close order hash in format "{sl|tp}@{tick}"
 * @throws Error if required threshold is missing
 */
export function deriveCloseOrderHashFromConfig(
  triggerMode: TriggerMode,
  sqrtPriceX96Lower: bigint | undefined,
  sqrtPriceX96Upper: bigint | undefined
): string {
  if (triggerMode === 'LOWER') {
    if (sqrtPriceX96Lower === undefined) {
      throw new Error('sqrtPriceX96Lower required for LOWER triggerMode');
    }
    return deriveCloseOrderHash(triggerMode, sqrtPriceX96Lower);
  } else {
    if (sqrtPriceX96Upper === undefined) {
      throw new Error('sqrtPriceX96Upper required for UPPER triggerMode');
    }
    return deriveCloseOrderHash(triggerMode, sqrtPriceX96Upper);
  }
}

/**
 * Derives a close order hash from numeric trigger mode and tick directly.
 * Avoids the sqrtPriceX96 roundtrip of `deriveCloseOrderHash()`.
 *
 * @param triggerMode - Numeric trigger mode (ContractTriggerMode.LOWER=0 or .UPPER=1)
 * @param tick - The trigger tick (int24)
 * @returns Close order hash in format "{sl|tp}@{tick}"
 */
export function deriveCloseOrderHashFromTick(
  triggerMode: ContractTriggerMode,
  tick: number
): string {
  return triggerMode === ContractTriggerMode.LOWER
    ? `sl@${tick}`
    : `tp@${tick}`;
}

/**
 * Parses a close order hash into its components
 *
 * @param hash - The close order hash string
 * @returns Parsed components (type and tick)
 * @throws Error if hash format is invalid
 */
export function parseCloseOrderHash(hash: string): CloseOrderHashComponents {
  const match = hash.match(CLOSE_ORDER_HASH_REGEX);
  if (!match) {
    throw new Error(
      `Invalid closeOrderHash format: "${hash}". Expected "sl@{tick}" or "tp@{tick}"`
    );
  }

  // match[1] and match[2] are guaranteed to exist after successful regex match
  return {
    type: match[1]! as CloseOrderHashType,
    tick: parseInt(match[2]!, 10),
  };
}

/**
 * Validates a close order hash format
 *
 * @param hash - The close order hash string to validate
 * @returns true if valid, false otherwise
 */
export function isValidCloseOrderHash(hash: string): boolean {
  return CLOSE_ORDER_HASH_REGEX.test(hash);
}

/**
 * Gets the trigger mode from a close order hash type
 *
 * @param type - The close order hash type ('sl' or 'tp')
 * @returns The corresponding TriggerMode
 */
export function hashTypeToTriggerMode(type: CloseOrderHashType): TriggerMode {
  return type === 'sl' ? 'LOWER' : 'UPPER';
}

/**
 * Gets the close order hash type from a trigger mode
 *
 * @param triggerMode - The trigger mode (LOWER or UPPER)
 * @returns The corresponding hash type ('sl' or 'tp')
 */
export function triggerModeToHashType(
  triggerMode: TriggerMode
): CloseOrderHashType {
  return triggerMode === 'LOWER' ? 'sl' : 'tp';
}
