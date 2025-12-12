/**
 * HODL Pool Configuration
 *
 * Immutable configuration for HODL virtual pools.
 * HODL pools are "virtual" pools used to reference a quote token for position valuation.
 *
 * Empty for now - future-proofed for multi-chain/multi-protocol support.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HodlPoolConfig {
  // Empty - no pool-specific config needed
  // The HODL position can include tokens from multiple chains and protocols
  // Chain/protocol information is tracked per-token in holdings or per-event
}
