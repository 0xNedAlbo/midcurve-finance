/**
 * Position Types and Schemas
 *
 * Re-exports all position-related types and schemas.
 * Includes both protocol-agnostic types (common) and protocol-specific types (uniswapv3).
 */

// Protocol-agnostic types
export * from './common/index.js';

// Uniswap V3-specific types
export * from './uniswapv3/index.js';

// UniswapV3 Vault-specific types
export * from './uniswapv3-vault/index.js';

// UniswapV3 Staking Vault-specific types (SPEC-0003b)
export * from './uniswapv3-staking/index.js';
