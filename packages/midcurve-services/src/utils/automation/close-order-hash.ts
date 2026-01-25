/**
 * Close Order Hash Utilities
 *
 * Provides functions for deriving, parsing, and validating close order hash identifiers.
 * Format: "{sl|tp}@{tick}" where:
 * - sl = Stop Loss (TriggerMode.LOWER)
 * - tp = Take Profit (TriggerMode.UPPER)
 * - tick = Integer tick derived from sqrtPriceX96
 */

import { TickMath } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { TriggerMode } from '@midcurve/shared';

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
 * Converts sqrtPriceX96 (bigint) to tick using Uniswap V3 TickMath
 *
 * @param sqrtPriceX96 - The sqrt price in Q96.96 format
 * @returns The floor tick at this sqrt price
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
  const jsbiSqrtPrice = JSBI.BigInt(sqrtPriceX96.toString());
  return TickMath.getTickAtSqrtRatio(jsbiSqrtPrice);
}

/**
 * Derives a close order hash from trigger mode and sqrtPriceX96
 *
 * @param triggerMode - The trigger mode (LOWER or UPPER)
 * @param sqrtPriceX96Trigger - The sqrtPriceX96 threshold that triggers the close
 * @returns Close order hash in format "{sl|tp}@{tick}"
 * @throws Error if triggerMode is BOTH (not supported)
 */
export function deriveCloseOrderHash(
  triggerMode: TriggerMode,
  sqrtPriceX96Trigger: bigint
): string {
  const tick = sqrtPriceX96ToTick(sqrtPriceX96Trigger);

  if (triggerMode === 'LOWER') {
    return `sl@${tick}`;
  } else if (triggerMode === 'UPPER') {
    return `tp@${tick}`;
  }

  throw new Error(
    'BOTH triggerMode not supported - create separate sl and tp orders'
  );
}

/**
 * Derives a close order hash from trigger mode and config's sqrtPriceX96 thresholds
 *
 * @param triggerMode - The trigger mode (LOWER or UPPER)
 * @param sqrtPriceX96Lower - Lower price threshold (used for LOWER trigger)
 * @param sqrtPriceX96Upper - Upper price threshold (used for UPPER trigger)
 * @returns Close order hash in format "{sl|tp}@{tick}"
 * @throws Error if triggerMode is BOTH or required threshold is missing
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
  } else if (triggerMode === 'UPPER') {
    if (sqrtPriceX96Upper === undefined) {
      throw new Error('sqrtPriceX96Upper required for UPPER triggerMode');
    }
    return deriveCloseOrderHash(triggerMode, sqrtPriceX96Upper);
  }

  throw new Error(
    'BOTH triggerMode not supported - create separate sl and tp orders'
  );
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
 * @throws Error if triggerMode is BOTH
 */
export function triggerModeToHashType(
  triggerMode: TriggerMode
): CloseOrderHashType {
  if (triggerMode === 'LOWER') {
    return 'sl';
  } else if (triggerMode === 'UPPER') {
    return 'tp';
  }
  throw new Error('BOTH triggerMode has no single hash type');
}
