/**
 * Authenticated User Type
 *
 * Type for authenticated users in middleware and route handlers.
 */

/**
 * Authenticated user type (for middleware usage)
 *
 * This is the user object available in authenticated requests.
 * It includes the user ID (always present) and optional profile fields.
 */
export interface AuthenticatedUser {
  id: string;
  address: string;
  name?: string | null;
}
