/**
 * List Hyperliquid API Wallets Types
 *
 * Types for the wallet listing endpoint.
 */

import type { ApiResponse } from '../common/index.js';
import type { HyperliquidEnvironment } from './register-wallet.js';

/**
 * Wallet display data (no sensitive information)
 */
export interface HyperliquidWalletDisplay {
  /**
   * Wallet record ID
   */
  id: string;

  /**
   * Public wallet address (EIP-55 checksummed)
   */
  walletAddress: string;

  /**
   * User-friendly label
   */
  label: string;

  /**
   * Hyperliquid environment
   */
  environment: HyperliquidEnvironment;

  /**
   * Whether the wallet is active
   */
  isActive: boolean;

  /**
   * Last time the wallet was used for signing (ISO string)
   */
  lastUsedAt: string | null;

  /**
   * When the wallet was registered (ISO string)
   */
  createdAt: string;

  /**
   * When the API wallet expires (ISO string)
   */
  expiresAt: string;
}

/**
 * GET /api/v1/user/hyperliquid-wallets response
 */
export type ListHyperliquidWalletsResponse =
  ApiResponse<HyperliquidWalletDisplay[]>;
