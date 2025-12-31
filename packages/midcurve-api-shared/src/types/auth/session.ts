import { z } from 'zod';
import type { AuthWalletAddress } from '@midcurve/shared';

/**
 * Session Types
 *
 * Types for session-related endpoints.
 */

/**
 * POST /api/v1/auth/verify request
 *
 * Verify a SIWE signature and create a session.
 */
export const VerifySessionRequestSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  message: z.string().min(1, 'Message is required'),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature format'),
});

export type VerifySessionRequest = z.infer<typeof VerifySessionRequestSchema>;

/**
 * User data returned in session responses
 */
export interface SessionUser {
  id: string;
  primaryWalletAddress: string;
  wallets: AuthWalletAddress[];
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/v1/auth/session response
 * POST /api/v1/auth/verify response
 *
 * Returns the current session user or null if not authenticated.
 */
export interface SessionResponse {
  user: SessionUser | null;
  expiresAt: string | null;
}

/**
 * POST /api/v1/auth/logout response
 */
export interface LogoutResponse {
  success: boolean;
}
