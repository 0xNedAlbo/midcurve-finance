/**
 * HODL Wallet Configuration Types
 *
 * Defines wallet configurations for HODL positions.
 * Supports multiple wallet types across different chains and platforms.
 */

/**
 * Wallet type discriminator
 *
 * Extensible for future wallet types:
 * - 'evm-onchain': Standard EVM wallet with on-chain balances
 * - Future: 'evm-hyperliquid', 'exchange-binance', 'solana-onchain', etc.
 */
export type HodlWalletType = 'evm-onchain';

/**
 * EVM on-chain wallet configuration
 *
 * Represents a wallet on a specific EVM chain.
 * One entry per chainId/address combination.
 */
export interface HodlEvmOnchainWallet {
  walletType: 'evm-onchain';

  /**
   * EVM chain ID (1 = Ethereum, 42161 = Arbitrum, etc.)
   */
  chainId: number;

  /**
   * Wallet address (EIP-55 checksummed)
   */
  address: string;
}

/**
 * Union of all wallet config types
 *
 * Discriminated by `walletType` for type-safe narrowing.
 * Add new wallet types here as they're implemented.
 */
export type HodlWalletConfig = HodlEvmOnchainWallet;
