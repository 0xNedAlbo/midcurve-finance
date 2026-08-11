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
] as const;

export type GasReadinessUnavailableReason =
  (typeof GAS_READINESS_UNAVAILABLE_REASONS)[number];

// =============================================================================
// GET /api/v1/automation/gas-readiness/:chainId
// =============================================================================

/** A contract-creation transaction the frontend can send as-is. */
export interface SerializedTreasuryDeployTransaction {
  /** Contract creation — no recipient */
  to: null;
  /** Creation bytecode with ABI-encoded constructor arguments appended */
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
