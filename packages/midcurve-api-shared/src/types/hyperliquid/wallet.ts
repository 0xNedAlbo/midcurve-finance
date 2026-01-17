/**
 * Hyperliquid Wallet API Types
 *
 * Types for managing the user's Hyperliquid API wallet.
 * Unlike EVM automation wallets (generated), HL wallets are imported
 * from user-provided private keys created on hyperliquid.xyz.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// =============================================================================
// GET HYPERLIQUID WALLET
// =============================================================================

/**
 * GET /api/v1/hyperliquid/wallet - Response data
 *
 * Returns the user's Hyperliquid wallet info, or null if no wallet exists.
 */
export interface GetHyperliquidWalletResponseData {
  /**
   * Wallet address (derived from stored key, 0x prefixed)
   */
  address: string;

  /**
   * User-provided label for the wallet
   */
  label: string;

  /**
   * ISO timestamp when wallet was imported
   */
  createdAt: string;

  /**
   * ISO timestamp when wallet was last used for signing, or null if never used
   */
  lastUsedAt: string | null;

  /**
   * ISO timestamp when the API wallet expires, or null if no expiry set
   */
  validUntil: string | null;
}

export type GetHyperliquidWalletResponse = ApiResponse<GetHyperliquidWalletResponseData | null>;

// =============================================================================
// IMPORT HYPERLIQUID WALLET
// =============================================================================

/**
 * POST /api/v1/hyperliquid/wallet - Request body
 *
 * Import a Hyperliquid API wallet using a user-provided private key.
 * The private key is created on hyperliquid.xyz and displayed once.
 */
export interface ImportHyperliquidWalletRequest {
  /**
   * Private key from Hyperliquid (0x prefixed, 64 hex chars)
   */
  privateKey: string;

  /**
   * Optional custom label for the wallet
   */
  label?: string;

  /**
   * Optional validity period in days (1-180).
   * If provided, validUntil will be calculated as now + validityDays.
   */
  validityDays?: number;
}

/**
 * Zod schema for import request validation
 */
export const ImportHyperliquidWalletRequestSchema = z.object({
  privateKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key format. Expected 0x followed by 64 hex characters.'),
  label: z
    .string()
    .max(100, 'Label must be 100 characters or less')
    .optional(),
  validityDays: z
    .number()
    .int('Validity days must be a whole number')
    .min(1, 'Validity must be at least 1 day')
    .max(180, 'Validity cannot exceed 180 days')
    .optional(),
});

/**
 * Inferred type from schema
 */
export type ImportHyperliquidWalletInput = z.infer<typeof ImportHyperliquidWalletRequestSchema>;

/**
 * POST /api/v1/hyperliquid/wallet - Response data
 */
export interface ImportHyperliquidWalletResponseData {
  /**
   * Wallet address (derived from private key)
   */
  address: string;

  /**
   * Wallet label
   */
  label: string;

  /**
   * ISO timestamp when wallet was created
   */
  createdAt: string;

  /**
   * ISO timestamp when the API wallet expires, or null if no expiry set
   */
  validUntil: string | null;
}

export type ImportHyperliquidWalletResponse = ApiResponse<ImportHyperliquidWalletResponseData>;

// =============================================================================
// DELETE HYPERLIQUID WALLET
// =============================================================================

/**
 * DELETE /api/v1/hyperliquid/wallet - Response data
 */
export interface DeleteHyperliquidWalletResponseData {
  /**
   * Whether the deletion was successful
   */
  success: boolean;
}

export type DeleteHyperliquidWalletResponse = ApiResponse<DeleteHyperliquidWalletResponseData>;
