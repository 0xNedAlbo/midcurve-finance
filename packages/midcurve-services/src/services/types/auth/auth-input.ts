/**
 * Auth Service Input Types
 *
 * These types are used for service-layer operations (CRUD).
 * NOT shared with API/UI - those use types from @midcurve/shared.
 */

import type { User, AuthWalletAddress, ApiKey } from '@prisma/client';

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

/**
 * User with API keys relation (without key hashes)
 */
export interface UserWithApiKeys extends User {
  apiKeys: Omit<ApiKey, 'keyHash'>[];
}

/**
 * User with all auth relations
 */
export interface UserWithAuth extends User {
  walletAddresses: AuthWalletAddress[];
  apiKeys: Omit<ApiKey, 'keyHash'>[];
}

// =============================================================================
// API Key Types
// =============================================================================

/**
 * Result of creating an API key
 * IMPORTANT: Full key is only returned here, cannot be recovered later
 */
export interface ApiKeyCreationResult {
  apiKey: ApiKey; // Database record
  key: string; // Full plaintext key (mc_live_...)
}

// NOTE: ApiKeyDisplay is now in @midcurve/shared and re-exported from there
// This allows it to be used by API, UI, and services without duplication
