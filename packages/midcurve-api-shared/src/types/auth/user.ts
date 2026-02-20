/**
 * User Types
 *
 * Types for user-related endpoints.
 */

import type { ApiResponse } from '../common';

/**
 * User data returned in API responses
 */
export interface UserData {
  id: string;
  address: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/v1/user/me response
 */
export type GetCurrentUserResponse = ApiResponse<UserData>;
