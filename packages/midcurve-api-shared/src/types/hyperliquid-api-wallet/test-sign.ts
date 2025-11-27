/**
 * Test Sign Types
 *
 * Types for the test signing endpoint to verify wallet is correctly stored.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

/**
 * Request to test sign a message
 */
export interface TestSignRequest {
  /**
   * Message to sign
   */
  message: string;
}

/**
 * Test sign response data
 */
export interface TestSignData {
  /**
   * The signature (0x-prefixed hex)
   */
  signature: string;

  /**
   * The wallet address that signed
   */
  walletAddress: string;
}

/**
 * POST /api/v1/user/hyperliquid-wallets/[id]/test-sign response
 */
export type TestSignResponse = ApiResponse<TestSignData>;

/**
 * Validation schema for test sign request
 */
export const testSignRequestSchema = z.object({
  message: z
    .string()
    .min(1, 'Message is required')
    .max(1000, 'Message must be 1000 characters or less'),
});
