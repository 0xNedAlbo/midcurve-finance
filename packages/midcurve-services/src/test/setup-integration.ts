/**
 * Setup file for integration tests
 * Runs for each test file
 *
 * Responsibilities:
 * - Clean database before AND after each test
 * - Provide clean state for each test suite
 * - Prevent state leaking between tests and test files
 */

import { beforeEach, afterEach } from 'vitest';
import { clearDatabase } from './helpers.js';

// Clean database before each test to ensure clean starting state
beforeEach(async () => {
  await clearDatabase();
});

// Clean database after each test to prevent state leaking to next test file
afterEach(async () => {
  await clearDatabase();
});
