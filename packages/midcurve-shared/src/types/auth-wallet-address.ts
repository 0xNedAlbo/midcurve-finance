/**
 * Auth Wallet Address Type
 *
 * Represents a blockchain wallet address associated with a user account.
 * Supports multiple wallets per user across different EVM chains.
 */

/**
 * Wallet address associated with a user
 *
 * A user can have multiple wallet addresses across different chains.
 * One wallet can be marked as primary for display purposes.
 */
export interface AuthWalletAddress {
  /**
   * Unique identifier (database-generated)
   */
  id: string;

  /**
   * User ID this wallet belongs to
   */
  userId: string;

  /**
   * Ethereum address (EIP-55 checksum format)
   * Normalized before storage
   */
  address: string;

  /**
   * EVM chain ID
   * - 1: Ethereum
   * - 42161: Arbitrum
   * - 8453: Base
   * - 56: BSC
   * - 137: Polygon
   * - 10: Optimism
   */
  chainId: number;

  /**
   * Whether this is the user's primary wallet
   * Used for default display and operations
   */
  isPrimary: boolean;

  /**
   * Creation timestamp
   */
  createdAt: Date;

  /**
   * Last update timestamp
   */
  updatedAt: Date;
}
