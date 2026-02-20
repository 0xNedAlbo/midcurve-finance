/**
 * Auth Service Input Types
 *
 * These types are used for service-layer operations (CRUD).
 * NOT shared with API/UI - those use types from @midcurve/shared.
 */

// =============================================================================
// User Input Types
// =============================================================================

/**
 * Input for creating a new user
 */
export interface CreateUserInput {
  address: string;
  name?: string;
}

/**
 * Input for updating user profile
 * Cannot update id, address, timestamps
 */
export interface UpdateUserInput {
  name?: string;
}
