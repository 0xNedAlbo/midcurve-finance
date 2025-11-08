/**
 * Authenticated User Type
 *
 * Type for authenticated users in middleware and route handlers.
 * Extracted from session.types.ts to be framework-agnostic.
 */

import type { AuthWalletAddress } from '@midcurve/shared';

/**
 * Authenticated user type (for middleware usage)
 *
 * This is the user object available in authenticated requests.
 * It includes the user ID (always present) and optional profile fields.
 */
export interface AuthenticatedUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  wallets?: AuthWalletAddress[];
}
