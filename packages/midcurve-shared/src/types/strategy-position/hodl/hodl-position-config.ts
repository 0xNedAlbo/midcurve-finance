/**
 * HODL Position Configuration
 *
 * Immutable configuration for HODL strategy positions.
 * Tracks which wallets are monitored for token balances.
 */

import type { HodlWalletConfig } from './hodl-wallet-config.js';

/**
 * HODL Position Config Interface
 *
 * Immutable configuration for a HODL position.
 * Tracks which wallets are monitored for this position.
 */
export interface HodlPositionConfigData {
  /**
   * Wallet configurations for this position
   *
   * Each entry represents a unique wallet location.
   * The position aggregates balances across all configured wallets.
   *
   * Uniqueness (e.g., no duplicate chainId+address for EVM)
   * is enforced at runtime, not at type level.
   */
  wallets: HodlWalletConfig[];
}

/**
 * HODL Position Config Class
 *
 * Provides methods for serialization and validation.
 */
export class HodlPositionConfig implements HodlPositionConfigData {
  readonly wallets: HodlWalletConfig[];

  constructor(data: HodlPositionConfigData) {
    this.wallets = data.wallets;
  }

  /**
   * Serialize to JSON-safe object for API/storage
   */
  toJSON(): Record<string, unknown> {
    return {
      wallets: this.wallets,
    };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: Record<string, unknown>): HodlPositionConfig {
    const wallets = json.wallets as HodlWalletConfig[];
    return new HodlPositionConfig({ wallets });
  }

  /**
   * Get the number of configured wallets
   */
  getWalletCount(): number {
    return this.wallets.length;
  }

  /**
   * Check if a wallet is already configured
   */
  hasWallet(walletType: string, chainId: number, address: string): boolean {
    return this.wallets.some(
      (w) =>
        w.walletType === walletType &&
        w.chainId === chainId &&
        w.address.toLowerCase() === address.toLowerCase()
    );
  }
}
