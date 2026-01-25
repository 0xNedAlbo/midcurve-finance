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
 * Format: "{type-prefix}/{name-kebab}/{major}/{minor}/{chainId}"
 *
 * @example
 * buildSharedContractHash('evm-smart-contract', 'UniswapV3PositionCloser', 1, 0, 31337)
 * // Returns: "evm/uniswap-v3-position-closer/1/0/31337"
 */
export function buildSharedContractHash(
  type: SharedContractType,
  name: SharedContractName,
  major: number,
  minor: number,
  chainId: number
): string {
  const typePrefix = getTypePrefix(type);
  const nameKebab = toKebabCase(name);
  return `${typePrefix}/${nameKebab}/${major}/${minor}/${chainId}`;
}

/**
 * Parse a shared contract hash into its components
 *
 * @example
 * parseSharedContractHash("evm/uniswap-v3-position-closer/1/0/31337")
 * // Returns: { typePrefix: "evm", nameKebab: "uniswap-v3-position-closer", major: 1, minor: 0, chainId: 31337 }
 */
export function parseSharedContractHash(hash: string): {
  typePrefix: string;
  nameKebab: string;
  major: number;
  minor: number;
  chainId: number;
} | null {
  const parts = hash.split('/');
  if (parts.length !== 5) {
    return null;
  }

  const typePrefix = parts[0]!;
  const nameKebab = parts[1]!;
  const majorStr = parts[2]!;
  const minorStr = parts[3]!;
  const chainIdStr = parts[4]!;

  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  const chainId = parseInt(chainIdStr, 10);

  if (isNaN(major) || isNaN(minor) || isNaN(chainId)) {
    return null;
  }

  return { typePrefix, nameKebab, major, minor, chainId };
}

/**
 * Build hash for UniswapV3PositionCloser on EVM
 * Convenience function for the most common use case
 */
export function buildUniswapV3PositionCloserHash(
  major: number,
  minor: number,
  chainId: number
): string {
  return buildSharedContractHash(
    SharedContractType.EVM_SMART_CONTRACT,
    SharedContractName.UNISWAP_V3_POSITION_CLOSER,
    major,
    minor,
    chainId
  );
}

/**
 * Parse interface version from uint32 format used by smart contracts
 *
 * The on-chain version format is: major * 100 + minor
 * - 100 = v1.0 (major=1, minor=0)
 * - 101 = v1.1 (major=1, minor=1)
 * - 150 = v1.50 (major=1, minor=50)
 * - 200 = v2.0 (major=2, minor=0)
 *
 * @example
 * parseInterfaceVersion(100) // { major: 1, minor: 0 }
 * parseInterfaceVersion(101) // { major: 1, minor: 1 }
 * parseInterfaceVersion(200) // { major: 2, minor: 0 }
 */
export function parseInterfaceVersion(version: number): {
  major: number;
  minor: number;
} {
  const major = Math.floor(version / 100);
  const minor = version % 100;
  return { major, minor };
}

/**
 * Build interface version number from major/minor components
 *
 * @example
 * buildInterfaceVersion(1, 0) // 100
 * buildInterfaceVersion(1, 1) // 101
 * buildInterfaceVersion(2, 0) // 200
 */
export function buildInterfaceVersion(major: number, minor: number): number {
  return major * 100 + minor;
}
