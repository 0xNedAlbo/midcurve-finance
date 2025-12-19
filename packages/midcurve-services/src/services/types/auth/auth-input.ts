/**
 * Auth Service Input Types
 *
 * These types are used for service-layer operations (CRUD).
 * NOT shared with API/UI - those use types from @midcurve/shared.
 */

import type { User, AuthWalletAddress } from '@midcurve/database';

// =============================================================================
// User Input Types
// =============================================================================

/**
 * Input for creating a new user
 * Optionally creates initial wallet in same transaction
 */
export interface CreateUserInput {
  name?: string;
  email?: string;
  image?: string;
  walletAddress?: string; // Optional: create user with initial wallet
  walletChainId?: number; // Required if walletAddress provided
}

/**
 * Input for updating user profile
 * Cannot update id, timestamps, or relations
 */
export interface UpdateUserInput {
  name?: string;
  email?: string;
  image?: string;
}

// =============================================================================
// User Relation Types
// =============================================================================

/**
 * User with wallet addresses relation
 */
export interface UserWithWallets extends User {
  walletAddresses: AuthWalletAddress[];
}
