/**
 * User Types
 *
 * Types for user-related endpoints.
 */

import type { ApiResponse } from '../common';
import type { AuthWalletAddress } from '@midcurve/shared';

/**
 * User data with wallets
 */
export interface UserData {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  wallets: AuthWalletAddress[];
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/v1/user/me response
 */
export type GetCurrentUserResponse = ApiResponse<UserData>;
