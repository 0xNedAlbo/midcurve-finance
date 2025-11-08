/**
 * User Input Types
 *
 * Input types for User CRUD operations.
 * These types are NOT shared with UI/API - they're specific to the service layer.
 */

import type { User } from '@prisma/client';

/**
 * Input type for creating a new user
 *
 * Omits database-generated fields: id, createdAt, updatedAt
 */
export type CreateUserInput = Omit<User, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Input type for updating an existing user
 *
 * All fields are optional (partial update).
 * Omits immutable fields: id, createdAt, updatedAt
 */
export type UpdateUserInput = Partial<
  Omit<User, 'id' | 'createdAt' | 'updatedAt'>
>;
