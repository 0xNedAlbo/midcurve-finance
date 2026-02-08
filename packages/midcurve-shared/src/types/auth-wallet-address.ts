/**
 * Auth Wallet Address Type
 *
 * Represents a blockchain wallet address associated with a user account.
 * Supports multiple wallets per user. Chain-agnostic: the same private key
 * controls an address across all EVM chains, so address alone is the identity.
 */

/**
 * Wallet address associated with a user
 *
 * A user can have multiple wallet addresses.
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
