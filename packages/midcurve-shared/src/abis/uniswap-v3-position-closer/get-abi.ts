// ============================================================================
// UniswapV3PositionCloser ABI Version Selector
// ============================================================================

import { UniswapV3PositionCloserV100Abi } from './v100';

/**
 * Contract version as returned by the API
 */
export interface ContractVersion {
  major: number;
  minor: number;
}

/**
 * Compute the version number from major and minor versions.
 * Formula: major * 100 + minor
 *
 * Examples:
 * - { major: 1, minor: 0 } => 100
 * - { major: 1, minor: 5 } => 105
 * - { major: 2, minor: 0 } => 200
 */
export function computeVersionNumber(version: ContractVersion): number {
  return version.major * 100 + version.minor;
}

/**
 * Get the ABI for a specific contract version.
 *
 * @param version - The contract version (major, minor)
 * @returns The ABI for that version
 * @throws Error if the version is not supported
 *
 * @example
 * ```typescript
 * const abi = getUniswapV3PositionCloserAbi({ major: 1, minor: 0 });
 * // Returns UniswapV3PositionCloserV100Abi
 * ```
 */
export function getUniswapV3PositionCloserAbi(version: ContractVersion) {
  const versionNumber = computeVersionNumber(version);

  switch (versionNumber) {
    case 100:
      return UniswapV3PositionCloserV100Abi;
    default:
      throw new Error(
        `Unsupported UniswapV3PositionCloser version: ${version.major}.${version.minor} (${versionNumber})`
      );
  }
}

/**
 * Type for the ABI returned by getUniswapV3PositionCloserAbi.
 * This is a union of all supported ABI types.
 */
export type UniswapV3PositionCloserAbi = typeof UniswapV3PositionCloserV100Abi;

/**
 * Check if a version is supported.
 *
 * @param version - The contract version to check
 * @returns true if the version is supported
 */
export function isVersionSupported(version: ContractVersion): boolean {
  const versionNumber = computeVersionNumber(version);
  return versionNumber === 100;
}

/**
 * Get all supported version numbers.
 */
export function getSupportedVersions(): number[] {
  return [100];
}
