/**
 * Hyperliquid Subaccount Types and Utilities
 *
 * Used for managing Hyperliquid subaccounts when creating hedges.
 * Each hedge uses a dedicated subaccount for margin isolation.
 */

/**
 * Subaccount info returned from Hyperliquid API
 */
export interface HyperliquidSubaccountInfo {
  /** Subaccount address (immutable identifier from Hyperliquid) */
  address: string;
  /** Current name of the subaccount */
  name: string;
  /** Master account address (parent) */
  masterAddress: string;
}

/**
 * Prefix for active hedge subaccount names
 * Format: mc-{positionHash:8}
 */
export const SUBACCOUNT_ACTIVE_PREFIX = 'mc-';

/**
 * Prefix for unused (released) subaccount names
 * Format: unused-{index}
 */
export const SUBACCOUNT_UNUSED_PREFIX = 'unused-';

/**
 * Generate a subaccount name for a new hedge
 * Takes first 8 characters of position hash for readability
 *
 * @param positionHash - Hash of the position being hedged
 * @returns Subaccount name in format "mc-{hash:8}"
 *
 * @example
 * generateSubaccountName("a1b2c3d4e5f6g7h8") // "mc-a1b2c3d4"
 */
export function generateSubaccountName(positionHash: string): string {
  const shortHash = positionHash.slice(0, 8);
  return `${SUBACCOUNT_ACTIVE_PREFIX}${shortHash}`;
}

/**
 * Generate an "unused" name for a released subaccount
 *
 * @param index - Sequential index for uniqueness
 * @returns Subaccount name in format "unused-{index}"
 *
 * @example
 * generateUnusedName(1) // "unused-1"
 * generateUnusedName(42) // "unused-42"
 */
export function generateUnusedName(index: number): string {
  return `${SUBACCOUNT_UNUSED_PREFIX}${index}`;
}

/**
 * Check if a subaccount name indicates it's actively linked to a hedge
 *
 * @param name - Subaccount name to check
 * @returns true if name starts with "mc-"
 */
export function isActiveSubaccountName(name: string): boolean {
  return name.startsWith(SUBACCOUNT_ACTIVE_PREFIX);
}

/**
 * Check if a subaccount name indicates it's unused (available for reuse)
 *
 * @param name - Subaccount name to check
 * @returns true if name starts with "unused-"
 */
export function isUnusedSubaccountName(name: string): boolean {
  return name.startsWith(SUBACCOUNT_UNUSED_PREFIX);
}

/**
 * Check if a subaccount was created by Midcurve
 * (either active "mc-" or unused "unused-")
 *
 * @param name - Subaccount name to check
 * @returns true if created by Midcurve
 */
export function isMidcurveSubaccount(name: string): boolean {
  return isActiveSubaccountName(name) || isUnusedSubaccountName(name);
}

/**
 * Extract the index from an unused subaccount name
 *
 * @param name - Unused subaccount name (e.g., "unused-42")
 * @returns The index number, or null if not a valid unused name
 *
 * @example
 * extractUnusedIndex("unused-42") // 42
 * extractUnusedIndex("mc-abc123") // null
 */
export function extractUnusedIndex(name: string): number | null {
  if (!isUnusedSubaccountName(name)) {
    return null;
  }
  const indexStr = name.slice(SUBACCOUNT_UNUSED_PREFIX.length);
  const index = parseInt(indexStr, 10);
  return isNaN(index) ? null : index;
}
