/**
 * Types for HyperliquidApiWalletService
 */

import type { HyperliquidEnvironment } from '@midcurve/shared';

// Re-export from shared for convenience
export type { HyperliquidEnvironment } from '@midcurve/shared';

/**
 * Input for registering a new API wallet
 */
export interface RegisterWalletInput {
  /**
   * User ID (from authenticated session)
   */
  userId: string;

  /**
   * Private key in 0x-prefixed hex format (66 characters)
   * Will be encrypted before storage
   */
  privateKey: string;

  /**
   * User-friendly label for the wallet
   */
  label: string;

  /**
   * Hyperliquid environment
   */
  environment: HyperliquidEnvironment;

  /**
   * When the API wallet expires (Hyperliquid default: 180 days from creation)
   */
  expiresAt: Date;
}

/**
 * Wallet info returned to clients (no sensitive data)
 */
export interface WalletInfo {
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
   * Last time the wallet was used for signing
   */
  lastUsedAt: Date | null;

  /**
   * When the wallet was registered
   */
  createdAt: Date;

  /**
   * When the API wallet expires
   */
  expiresAt: Date;
}

/**
 * Input for test signing
 */
export interface TestSignInput {
  /**
   * User ID (from authenticated session)
   */
  userId: string;

  /**
   * Wallet record ID
   */
  walletId: string;

  /**
   * Message to sign
   */
  message: string;
}

/**
 * Result of test signing
 */
export interface TestSignResult {
  /**
   * The signature
   */
  signature: string;

  /**
   * The wallet address that signed
   */
  walletAddress: string;
}
