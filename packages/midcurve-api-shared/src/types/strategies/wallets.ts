/**
 * Strategy Wallet Management Endpoint Types
 *
 * Types for linking and unlinking automation wallets to/from strategies.
 */

import type { ApiResponse } from '../common/index.js';
import type { SerializedStrategy } from './common.js';
import type { BigIntToString } from '../common/index.js';
import type { StrategyAutomationWallet } from '@midcurve/shared';
import { z } from 'zod';

// =============================================================================
// SERIALIZED WALLET TYPE
// =============================================================================

/**
 * Serialized automation wallet for API response
 */
export type SerializedAutomationWallet = BigIntToString<StrategyAutomationWallet>;

// =============================================================================
// LINK AUTOMATION WALLET TO STRATEGY
// =============================================================================

/**
 * POST /api/v1/strategies/:id/wallets - Request body
 *
 * Links an automation wallet to a strategy.
 */
export interface LinkStrategyWalletRequest {
  /**
   * Automation wallet ID to link
   */
  walletId: string;
}

/**
 * Zod schema for link strategy wallet request
 */
export const LinkStrategyWalletRequestSchema = z.object({
  walletId: z
    .string()
    .min(1, 'Wallet ID is required'),
});

/**
 * Inferred type from schema
 */
export type LinkStrategyWalletInput = z.infer<typeof LinkStrategyWalletRequestSchema>;

/**
 * POST /api/v1/strategies/:id/wallets - Response
 *
 * Returns the updated strategy with linked wallets.
 */
export type LinkStrategyWalletResponse = ApiResponse<SerializedStrategy>;

// =============================================================================
// UNLINK WALLET
// =============================================================================

/**
 * DELETE /api/v1/strategies/:id/wallets/:walletId - Response
 *
 * Unlinks an automation wallet from a strategy.
 * No request body required.
 */
export type UnlinkWalletResponse = ApiResponse<{ success: true }>;

// =============================================================================
// GET WALLETS
// =============================================================================

/**
 * GET /api/v1/strategies/:id/wallets - Response
 *
 * Returns all automation wallets linked to a strategy.
 */
export type GetStrategyWalletsResponse = ApiResponse<SerializedAutomationWallet[]>;
