/**
 * Gas Readiness Endpoint Types
 *
 * Types for the per-chain close-order gas readiness gate.
 *
 * Everything on the wire is a flat string, number or boolean: wei amounts are
 * decimal strings, addresses are EIP-55 strings, and nothing carries methods
 * or bigints. No `*Wire` variant is warranted.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// =============================================================================
// Status
// =============================================================================

export const GAS_READINESS_STATUSES = [
  'ready',
  'needs-kickstart',
  'needs-topup',
  'unavailable',
] as const;

export type GasReadinessStatus = (typeof GAS_READINESS_STATUSES)[number];

export const GAS_READINESS_UNAVAILABLE_REASONS = [
  'unsupported-chain',
  'no-wrapped-native-currency',
  'no-operator-address',
  'no-admin-address',
  'no-swap-router',
  'no-treasury-factory',
] as const;

export type GasReadinessUnavailableReason =
  (typeof GAS_READINESS_UNAVAILABLE_REASONS)[number];

// =============================================================================
// GET /api/v1/automation/gas-readiness/:chainId
// =============================================================================

/** A createTreasury() call on the chain's factory, sendable as-is. */
export interface SerializedTreasuryDeployTransaction {
  /** The chain's registered MidcurveTreasuryFactory */
  to: string;
  /** Encoded createTreasury(admin, operator) */
  data: string;
  /** Always "0" */
  value: string;
}

/** A plain native-value transfer the frontend can send as-is. */
export interface SerializedOperatorFundingTransaction {
  to: string;
  value: string;
}

export interface SerializedGasReadinessTreasury {
  registeredAddress: string | null;
  boundOperator: string | null;
  operatorBindingMismatch: boolean;
  /**
   * The admin the registered treasury actually answers to.
   *
   * Read on every readiness check, not only at registration. A treasury whose
   * admin has drifted from this environment's configured admin is one nobody
   * here can sweep — heavier than an operator drift, which only misdirects a
   * refuel while leaving the funds retrievable.
   */
  boundAdmin: string | null;
  adminBindingMismatch: boolean;
  /**
   * Where createTreasury() would put this environment's instance, from the
   * factory. Present whenever a factory is registered.
   *
   * The address the deploy step registers, so nothing depends on reading it
   * back out of a transaction receipt.
   */
  expectedAddress: string | null;
  /**
   * An instance that exists on chain but has no shared_contracts row.
   *
   * When set, the flow offers registration alone — there is nothing to deploy.
   */
  unregisteredAddress: string | null;
}

export interface GasReadinessData {
  chainId: number;
  status: GasReadinessStatus;
  unavailableReason: GasReadinessUnavailableReason | null;

  operatorAddress: string | null;
  adminAddress: string | null;

  /** Wei, decimal string */
  operatorBalanceWei: string | null;
  walletBalanceWei: string | null;
  readinessThresholdWei: string | null;
  fundingAmountWei: string | null;

  treasury: SerializedGasReadinessTreasury;

  needsTreasuryRegistration: boolean;
  needsOperatorFunding: boolean;
  walletBalanceInsufficient: boolean;

  deployTx: SerializedTreasuryDeployTransaction | null;
  fundTx: SerializedOperatorFundingTransaction | null;
}

export type GetGasReadinessResponse = ApiResponse<GasReadinessData>;

/** Optional connected wallet, so the funding step can explain itself. */
export const GasReadinessQuerySchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address')
    .optional(),
});

export type GasReadinessQuery = z.infer<typeof GasReadinessQuerySchema>;

// =============================================================================
// POST /api/v1/automation/gas-readiness/:chainId/treasury
// =============================================================================

/**
 * Register a deployed treasury.
 *
 * The address comes from the deploy transaction receipt. The server verifies
 * on chain that it is this environment's treasury before writing anything —
 * see GasReadinessService.registerTreasury.
 */
export const RegisterTreasuryBodySchema = z.object({
  address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
});

export type RegisterTreasuryBody = z.infer<typeof RegisterTreasuryBodySchema>;

export interface RegisterTreasuryResponseData {
  chainId: number;
  /** EIP-55 checksummed address of the registered treasury */
  address: string;
}

export type RegisterTreasuryResponse = ApiResponse<RegisterTreasuryResponseData>;
