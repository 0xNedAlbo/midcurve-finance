/**
 * Automation Wallet Types
 *
 * Types for EVM Automation Wallets managed by the midcurve-signer service.
 * These wallets use AWS KMS for key management - the private key never leaves the HSM.
 */

/**
 * Key provider for the automation wallet
 */
export type AutomationWalletKeyProvider = 'aws-kms' | 'local-dev';

/**
 * Automation wallet display data returned from GET endpoint
 * Does NOT include sensitive key information
 */
export interface AutomationWalletDisplay {
  /** Unique wallet ID */
  id: string;
  /** EIP-55 checksummed Ethereum address */
  walletAddress: string;
  /** User-friendly label */
  label: string;
  /** Key provider (aws-kms for production, local-dev for development) */
  keyProvider: AutomationWalletKeyProvider;
  /** Whether wallet is active */
  isActive: boolean;
  /** ISO timestamp when wallet was created */
  createdAt: string;
  /** ISO timestamp when wallet was last used (null if never used) */
  lastUsedAt: string | null;
}

/**
 * Request body for creating an automation wallet
 */
export interface CreateAutomationWalletRequest {
  /** Optional label for the wallet (defaults to "Automation Wallet") */
  label?: string;
}

/**
 * Response data from creating an automation wallet
 */
export interface CreateAutomationWalletResponse {
  /** Unique wallet ID */
  id: string;
  /** EIP-55 checksummed Ethereum address */
  walletAddress: string;
  /** User-friendly label */
  label: string;
}
