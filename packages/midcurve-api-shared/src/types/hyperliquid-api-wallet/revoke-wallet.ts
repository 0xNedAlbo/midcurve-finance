/**
 * Revoke Hyperliquid API Wallet Types
 *
 * Types for the wallet revocation endpoint.
 */

import type { ApiResponse } from '../common/index.js';

/**
 * Revoke wallet response data
 */
export interface RevokeHyperliquidWalletData {
  /**
   * Success message
   */
  message: string;
}

/**
 * DELETE /api/v1/user/hyperliquid-wallets/[id] response
 */
export type RevokeHyperliquidWalletResponse =
  ApiResponse<RevokeHyperliquidWalletData>;
