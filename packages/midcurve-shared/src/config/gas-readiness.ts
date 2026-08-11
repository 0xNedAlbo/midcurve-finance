/**
 * Gas Readiness Configuration
 *
 * Per-chain thresholds for the close-order gas readiness gate.
 *
 * Close-order execution is paid for by a single operator EOA per environment,
 * out of its native balance on whichever chain the order lives. Nothing tops
 * that balance up automatically today. The readiness gate, shown at the point
 * of registering a close order, offers the user the chance to fund it.
 *
 * Two numbers per chain:
 *
 * - `readinessThresholdWei` — below this, the operator is treated as unable to
 *   pay and a top-up is offered. Sized at roughly three executions, matching
 *   the executor's three-attempt retry budget.
 * - `fundingAmountWei` — the fixed amount the top-up transfers. Sized at
 *   roughly ten executions. Not user-editable and not estimated per position.
 *
 * A close-order execution runs roughly 500-800k gas, so these differ by orders
 * of magnitude between L1 and L2.
 *
 * `RefuelOperatorRule` derives its own trigger from `readinessThresholdWei`
 * rather than carrying a constant of its own — at a multiple, so the refuel
 * fires *before* the gate would ask the user for money the treasury could have
 * supplied. Changing a threshold here therefore moves the refuel trigger on
 * that chain too, and the invariant the rule's tests pin is
 * `refuelTrigger > readinessThreshold`, not any particular multiple. Until #125
 * the rule used a single global 0.01 ETH instead, which sat below one
 * execution's gas on Ethereum.
 *
 * These are per-chain facts rather than per-environment secrets, so they live
 * here as constants rather than in `system_config`.
 */

import { PRODUCTION_CHAIN_IDS } from './chain-registry.js';

// ============================================================================
// Types
// ============================================================================

export interface GasReadinessConfig {
  /** Operator native balance below which a top-up is offered (wei) */
  readinessThresholdWei: bigint;
  /** Fixed amount a top-up transfers to the operator (wei) */
  fundingAmountWei: bigint;
}

// ============================================================================
// Registry Data
// ============================================================================

export const GAS_READINESS_CONFIG: Readonly<
  Record<number, GasReadinessConfig>
> = {
  // Ethereum — ~0.015 ETH per execution at 20 gwei
  1: {
    readinessThresholdWei: 50_000_000_000_000_000n, // 0.05 ETH
    fundingAmountWei: 150_000_000_000_000_000n, // 0.15 ETH
  },
  // Arbitrum
  42161: {
    readinessThresholdWei: 5_000_000_000_000_000n, // 0.005 ETH
    fundingAmountWei: 10_000_000_000_000_000n, // 0.01 ETH
  },
  // Base
  8453: {
    readinessThresholdWei: 5_000_000_000_000_000n, // 0.005 ETH
    fundingAmountWei: 10_000_000_000_000_000n, // 0.01 ETH
  },
  // Sepolia — testnet, same shape as an L2 so the gate is exercisable
  11155111: {
    readinessThresholdWei: 5_000_000_000_000_000n, // 0.005 ETH
    fundingAmountWei: 10_000_000_000_000_000n, // 0.01 ETH
  },
  // Local anvil fork
  31337: {
    readinessThresholdWei: 5_000_000_000_000_000n, // 0.005 ETH
    fundingAmountWei: 10_000_000_000_000_000n, // 0.01 ETH
  },
};

// ============================================================================
// Accessors
// ============================================================================

/**
 * Gas readiness configuration for a chain.
 *
 * @throws if the chain has no configuration — a chain that can host a position
 *         but has no readiness numbers is a gap, not a default.
 */
export function getGasReadinessConfig(chainId: number): GasReadinessConfig {
  const config = GAS_READINESS_CONFIG[chainId];
  if (!config) {
    throw new Error(
      `No gas readiness configuration for chain ${chainId}. ` +
        `Configured chains: ${Object.keys(GAS_READINESS_CONFIG).join(', ')}`,
    );
  }
  return config;
}

/** Whether a chain has gas readiness numbers configured. */
export function hasGasReadinessConfig(chainId: number): boolean {
  return chainId in GAS_READINESS_CONFIG;
}

/** Chain IDs with gas readiness numbers configured. */
export const GAS_READINESS_CHAIN_IDS: readonly number[] = Object.keys(
  GAS_READINESS_CONFIG,
).map(Number);

/**
 * Production chains missing a readiness configuration.
 *
 * Exported so a test can assert this is empty rather than discovering the gap
 * at runtime on a chain nobody exercised.
 */
export function getProductionChainsMissingGasReadiness(): number[] {
  return PRODUCTION_CHAIN_IDS.filter((id) => !hasGasReadinessConfig(id));
}
