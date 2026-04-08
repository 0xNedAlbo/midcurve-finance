/**
 * User Wallet Management API Types
 *
 * Types for wallet CRUD, ownership verification, and wallet perimeter management.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// =============================================================================
// WALLET DATA
// =============================================================================

/**
 * Serialized user wallet for API responses
 */
export interface UserWalletResponse {
  id: string;
  walletType: string;
  walletHash: string;
  label: string | null;
  config: Record<string, unknown>;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// LIST WALLETS
// =============================================================================

export interface ListUserWalletsResponseData {
  wallets: UserWalletResponse[];
}

export type ListUserWalletsResponse = ApiResponse<ListUserWalletsResponseData>;

// =============================================================================
// WALLET CHALLENGE (ownership verification)
// =============================================================================

export const WalletChallengeRequestSchema = z.object({
  walletType: z.string().min(1),
  address: z.string().min(1),
});

export type WalletChallengeRequest = z.infer<typeof WalletChallengeRequestSchema>;

export interface WalletChallengeResponseData {
  message: string;
  nonce: string;
}

export type WalletChallengeResponse = ApiResponse<WalletChallengeResponseData>;

// =============================================================================
// ADD WALLET
// =============================================================================

export const AddWalletRequestSchema = z.object({
  walletType: z.string().min(1),
  address: z.string().min(1),
  signature: z.string().min(1),
  nonce: z.string().min(1),
  label: z.string().max(100).optional(),
});

export type AddWalletRequest = z.infer<typeof AddWalletRequestSchema>;

export interface AddWalletResponseData {
  wallet: UserWalletResponse;
}

export type AddWalletResponse = ApiResponse<AddWalletResponseData>;

// =============================================================================
// DELETE WALLET
// =============================================================================

export interface DeleteWalletResponseData {
  deleted: true;
}

export type DeleteWalletResponse = ApiResponse<DeleteWalletResponseData>;
