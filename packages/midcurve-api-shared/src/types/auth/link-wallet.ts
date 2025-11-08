/**
 * Link Wallet Types
 *
 * Types for linking additional wallets to user account.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common';
import type { AuthWalletAddress } from '@midcurve/shared';

/**
 * Request to link additional wallet
 */
export interface LinkWalletRequest {
  message: string; // SIWE message JSON
  signature: string; // Hex signature
}

/**
 * Wallet data returned after linking
 */
export interface LinkWalletData {
  id: string;
  address: string;
  chainId: number;
  isPrimary: boolean;
  createdAt: string;
}

/**
 * POST /api/v1/auth/link-wallet response
 */
export type LinkWalletResponse = ApiResponse<LinkWalletData>;

/**
 * GET /api/v1/user/wallets response
 */
export type ListWalletsResponse = ApiResponse<AuthWalletAddress[]>;

/**
 * PATCH /api/v1/user/wallets/[id]/primary response
 */
export type SetPrimaryWalletResponse = ApiResponse<LinkWalletData>;

/**
 * Validation schemas
 */
export const LinkWalletRequestSchema = z.object({
  message: z.string().min(1, 'SIWE message is required'),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/, 'Invalid signature format'),
});
