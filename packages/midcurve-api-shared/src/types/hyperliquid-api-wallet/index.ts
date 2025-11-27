/**
 * Hyperliquid API Wallet Types
 *
 * Types and schemas for Hyperliquid API wallet management endpoints.
 */

// Register wallet
export type {
  HyperliquidEnvironment,
  RegisterHyperliquidWalletRequest,
  RegisterHyperliquidWalletData,
  RegisterHyperliquidWalletResponse,
} from './register-wallet.js';
export { registerHyperliquidWalletSchema } from './register-wallet.js';

// List wallets
export type {
  HyperliquidWalletDisplay,
  ListHyperliquidWalletsResponse,
} from './list-wallets.js';

// Revoke wallet
export type {
  RevokeHyperliquidWalletData,
  RevokeHyperliquidWalletResponse,
} from './revoke-wallet.js';

// Test sign
export type {
  TestSignRequest,
  TestSignData,
  TestSignResponse,
} from './test-sign.js';
export { testSignRequestSchema } from './test-sign.js';
