/**
 * User Type Definitions
 *
 * Simple user model for position tracking and identification.
 * No authentication logic - that's handled by the API project.
 */

/**
 * User interface
 *
 * User model for authentication and position tracking.
 * Supports multiple authentication methods (wallet, email in future).
 */
export interface User {
  /**
   * Unique identifier (database-generated)
   */
  id: string;

  /**
   * User's display name
   * Optional - user may not have set a name yet
   */
  name: string | null;

  /**
   * User's email address
   * Optional - used for email-based authentication (future)
   * Must be unique if provided
   */
  email: string | null;

  /**
   * User's profile picture URL
   * Optional - avatar or profile image
   */
  image: string | null;

  /**
   * Creation timestamp
   */
  createdAt: Date;

  /**
   * Last update timestamp
   */
  updatedAt: Date;
}
