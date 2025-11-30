/**
 * Automation Wallet Zod Schemas
 *
 * Request validation schemas for automation wallet endpoints.
 */

import { z } from 'zod';

/**
 * Schema for creating an automation wallet
 */
export const createAutomationWalletSchema = z.object({
  /** Optional label for the wallet (1-50 characters) */
  label: z.string().min(1).max(50).optional(),
});

/**
 * Inferred type from the schema
 */
export type CreateAutomationWalletInput = z.infer<typeof createAutomationWalletSchema>;
