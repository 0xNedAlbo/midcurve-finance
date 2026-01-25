// ============================================================================
// Shared Contract Utilities
// ============================================================================

import {
  SharedContractType,
  SharedContractName,
} from './shared-contract.types';

/**
 * Convert PascalCase name to kebab-case
 * Example: "UniswapV3PositionCloser" -> "uniswap-v3-position-closer"
 */
function toKebabCase(name: string): string {
  return name
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .slice(1); // Remove leading dash
}

/**
 * Extract type prefix from sharedContractType
 * Example: "evm-smart-contract" -> "evm"
 */
function getTypePrefix(type: SharedContractType): string {
  return type.replace('-smart-contract', '');
}

/**
 * Build a semantic hash for shared contract lookups
 *
 * Format: "{type-prefix}/{name-kebab}/{major}/{minor}"
 *
 * @example
 * buildSharedContractHash('evm-smart-contract', 'UniswapV3PositionCloser', 1, 0)
 * // Returns: "evm/uniswap-v3-position-closer/1/0"
 */
export function buildSharedContractHash(
  type: SharedContractType,
  name: SharedContractName,
  major: number,
  minor: number
): string {
  const typePrefix = getTypePrefix(type);
  const nameKebab = toKebabCase(name);
  return `${typePrefix}/${nameKebab}/${major}/${minor}`;
}

/**
 * Parse a shared contract hash into its components
 *
 * @example
 * parseSharedContractHash("evm/uniswap-v3-position-closer/1/0")
 * // Returns: { typePrefix: "evm", nameKebab: "uniswap-v3-position-closer", major: 1, minor: 0 }
 */
export function parseSharedContractHash(hash: string): {
  typePrefix: string;
  nameKebab: string;
  major: number;
  minor: number;
} | null {
  const parts = hash.split('/');
  if (parts.length !== 4) {
    return null;
  }

  const typePrefix = parts[0]!;
  const nameKebab = parts[1]!;
  const majorStr = parts[2]!;
  const minorStr = parts[3]!;

  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);

  if (isNaN(major) || isNaN(minor)) {
    return null;
  }

  return { typePrefix, nameKebab, major, minor };
}

/**
 * Build hash for UniswapV3PositionCloser on EVM
 * Convenience function for the most common use case
 */
export function buildUniswapV3PositionCloserHash(
  major: number,
  minor: number
): string {
  return buildSharedContractHash(
    SharedContractType.EVM_SMART_CONTRACT,
    SharedContractName.UNISWAP_V3_POSITION_CLOSER,
    major,
    minor
  );
}
