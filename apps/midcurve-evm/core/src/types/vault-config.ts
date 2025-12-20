/**
 * Vault Configuration Types
 *
 * Platform-independent vault configuration stored in the database.
 * Currently supports EVM vaults; extensible to other platforms (Solana, etc.)
 */

import type { Address } from 'viem';

// =============================================================================
// Vault Config Types (Platform-Independent)
// =============================================================================

/**
 * Base vault config interface
 * All vault configs must have a type discriminator
 */
interface BaseVaultConfig {
  type: string;
}

/**
 * EVM vault configuration
 * Used for SimpleTokenVault deployed on EVM-compatible chains
 */
export interface EvmVaultConfig extends BaseVaultConfig {
  type: 'evm';
  /** Public chain ID (1 = Ethereum, 42161 = Arbitrum, etc.) */
  chainId: number;
  /** Vault contract address (EIP-55 checksummed) */
  vaultAddress: string;
}

// Future platform configs can be added here:
// export interface SolanaVaultConfig extends BaseVaultConfig {
//   type: 'solana';
//   programId: string;
//   vaultPda: string;
// }

/**
 * Union type of all supported vault configs
 * Extend this as new platforms are added
 */
export type VaultConfig = EvmVaultConfig;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a vault config is an EVM vault
 */
export function isEvmVaultConfig(config: VaultConfig): config is EvmVaultConfig {
  return config.type === 'evm';
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate an EVM vault config
 * @throws Error if config is invalid
 */
export function validateEvmVaultConfig(config: unknown): asserts config is EvmVaultConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Vault config must be an object');
  }

  const c = config as Record<string, unknown>;

  if (c.type !== 'evm') {
    throw new Error(`Invalid vault config type: ${c.type}`);
  }

  if (typeof c.chainId !== 'number' || c.chainId <= 0) {
    throw new Error(`Invalid chainId: ${c.chainId}`);
  }

  if (typeof c.vaultAddress !== 'string' || !c.vaultAddress.startsWith('0x')) {
    throw new Error(`Invalid vaultAddress: ${c.vaultAddress}`);
  }
}

/**
 * Parse and validate vault config from database JSON
 * @throws Error if config is invalid
 */
export function parseVaultConfig(json: unknown): VaultConfig {
  if (!json || typeof json !== 'object') {
    throw new Error('Vault config must be an object');
  }

  const config = json as Record<string, unknown>;

  switch (config.type) {
    case 'evm':
      validateEvmVaultConfig(json);
      return json as EvmVaultConfig;
    default:
      throw new Error(`Unknown vault config type: ${config.type}`);
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create an EVM vault config
 */
export function createEvmVaultConfig(
  chainId: number,
  vaultAddress: Address
): EvmVaultConfig {
  return {
    type: 'evm',
    chainId,
    vaultAddress,
  };
}
