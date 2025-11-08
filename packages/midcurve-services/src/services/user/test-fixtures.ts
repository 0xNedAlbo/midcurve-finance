/**
 * User Test Fixtures
 *
 * Reusable test data for UserService tests.
 * Provides consistent, realistic test data.
 */

import type { User } from '@prisma/client';
import type { CreateUserInput } from '../types/user/index.js';

/**
 * User fixture structure
 *
 * Contains both the input for service.create() and the expected database result.
 */
export interface UserFixture {
  /**
   * Input for service.create()
   */
  input: CreateUserInput;

  /**
   * Expected database result (with id and timestamps)
   */
  dbResult: User;
}

/**
 * Alice - A typical user
 */
export const ALICE: UserFixture = {
  input: {
    name: 'Alice',
    email: null,
    image: null,
  },
  dbResult: {
    id: 'user_alice_001',
    name: 'Alice',
    email: null,
    image: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  },
};

/**
 * Bob - Another typical user
 */
export const BOB: UserFixture = {
  input: {
    name: 'Bob',
    email: null,
    image: null,
  },
  dbResult: {
    id: 'user_bob_001',
    name: 'Bob',
    email: null,
    image: null,
    createdAt: new Date('2024-01-02T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  },
};

/**
 * Charlie - User with a longer name
 */
export const CHARLIE: UserFixture = {
  input: {
    name: 'Charlie Thompson',
    email: null,
    image: null,
  },
  dbResult: {
    id: 'user_charlie_001',
    name: 'Charlie Thompson',
    email: null,
    image: null,
    createdAt: new Date('2024-01-03T00:00:00.000Z'),
    updatedAt: new Date('2024-01-03T00:00:00.000Z'),
  },
};

/**
 * Helper function to create a custom user fixture
 *
 * @param overrides - Partial overrides for the fixture
 * @returns A complete user fixture
 *
 * @example
 * ```typescript
 * const customUser = createUserFixture({ name: 'David' });
 * ```
 */
export function createUserFixture(
  overrides: Partial<CreateUserInput> & { id?: string } = {}
): UserFixture {
  const name = overrides.name ?? 'Test User';
  const email = overrides.email ?? null;
  const image = overrides.image ?? null;
  const id = overrides.id ?? 'user_test_001';

  return {
    input: {
      name,
      email,
      image,
    },
    dbResult: {
      id,
      name,
      email,
      image,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    },
  };
}
