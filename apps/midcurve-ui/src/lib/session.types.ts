/**
 * Extended Session Types for Auth.js
 *
 * Extends the default Auth.js session to include user ID and wallet addresses.
 */

import type { DefaultSession } from 'next-auth';
import type { AuthWalletAddress } from '@midcurve/shared';

/**
 * Extend Auth.js module to include custom user fields
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      wallets?: AuthWalletAddress[];
    } & DefaultSession['user'];
  }
}

/**
 * Authenticated user type (for middleware usage)
 */
export interface AuthenticatedUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  wallets?: AuthWalletAddress[];
}
