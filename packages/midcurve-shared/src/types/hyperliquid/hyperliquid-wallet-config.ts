/**
 * Hyperliquid Wallet Configuration
 *
 * Configuration stored in AutomationWallet.config for Hyperliquid API wallets.
 *
 * Unlike EVM automation wallets (where we generate the key), Hyperliquid wallets
 * are imported from user-provided private keys created on hyperliquid.xyz.
 *
 * Flow:
 * 1. User creates API wallet on hyperliquid.xyz
 * 2. User copies private key (displayed once)
 * 3. User pastes into midcurve UI
 * 4. We encrypt and store in this config
 */

/**
 * Key provider type for Hyperliquid wallets
 *
 * Currently only 'local' is supported since users provide their own keys.
 * KMS would require generating keys in KMS, which isn't the HL flow.
 */
export type HyperliquidKeyProvider = 'local';

/**
 * Configuration for a Hyperliquid API wallet stored in AutomationWallet.config
 */
export interface HyperliquidWalletConfig {
  /**
   * Wallet address derived from the private key (0x prefixed, checksummed)
   */
  walletAddress: string;

  /**
   * Key provider - always 'local' for imported keys
   */
  keyProvider: HyperliquidKeyProvider;

  /**
   * AES-256-GCM encrypted private key
   * Format: salt:iv:authTag:encryptedData (all hex encoded)
   */
  encryptedPrivateKey: string;

  /**
   * Optional ISO timestamp when the API wallet expires.
   * Set when user provides validityDays during import.
   */
  validUntil?: string;
}
