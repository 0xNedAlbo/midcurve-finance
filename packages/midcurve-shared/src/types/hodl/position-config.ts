/**
 * HODL Position Configuration
 *
 * Immutable configuration for HODL positions.
 * HODL positions track baskets of tokens valued in a user-selected quote token.
 *
 * Empty for now - future-proofed for multi-chain/multi-protocol support.
 * The basket can include tokens from multiple chains and protocols.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HodlPositionConfig {
  // Empty for now - future-proofed for multi-chain/multi-protocol holdings
  // The basket can include tokens from multiple chains and protocols
  // Wallet addresses are tracked per-token in the holdings or per-event
}
