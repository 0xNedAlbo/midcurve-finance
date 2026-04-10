// ============================================================================
// UniswapV3VaultPositionCloser ABI Version Selector
// ============================================================================

import { UniswapV3VaultPositionCloserV100Abi } from './v100';

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
 */
export function getUniswapV3VaultPositionCloserAbi(version: ContractVersion) {
  const versionNumber = computeVersionNumber(version);

  switch (versionNumber) {
    case 100:
      return UniswapV3VaultPositionCloserV100Abi;
    default:
      throw new Error(
        `Unsupported UniswapV3VaultPositionCloser version: ${version.major}.${version.minor} (${versionNumber})`
      );
  }
}

/**
 * Type for the ABI returned by getUniswapV3VaultPositionCloserAbi.
 */
export type UniswapV3VaultPositionCloserAbi = typeof UniswapV3VaultPositionCloserV100Abi;

/**
 * Check if a version is supported.
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
