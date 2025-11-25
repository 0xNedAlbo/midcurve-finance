/**
 * Risk Asset Types
 *
 * Economic risk asset identifiers and classifications.
 * These represent underlying economic exposure, not specific on-chain tokens.
 */

/**
 * Economic risk asset identifiers
 *
 * Maps on-chain tokens to their underlying economic exposure:
 * - WETH, stETH, cbETH → ETH
 * - WBTC, tBTC, cbBTC → BTC
 * - USDC, USDT, DAI, FRAX → USD
 */
export type RiskAssetId =
  | 'ETH' // Ethereum and wrapped/staked variants
  | 'BTC' // Bitcoin and wrapped variants
  | 'USD' // USD stablecoins (USDC, USDT, DAI, FRAX)
  | 'EUR' // EUR stablecoins (EURS, EURT)
  | 'SOL' // Solana (future)
  | 'OTHER'; // Unclassified assets

/**
 * Role classification for risk calculation
 *
 * Determines how the asset behaves in risk calculations:
 * - volatile: Price fluctuates significantly (ETH, BTC, SOL)
 * - stable: Pegged to fiat currency (USDC, DAI)
 * - other: Unknown or exotic assets
 */
export type RiskAssetRole = 'volatile' | 'stable' | 'other';

/**
 * Risk asset definition
 *
 * Combines identifier with metadata for display and classification.
 */
export interface RiskAsset {
  /** Economic asset identifier */
  id: RiskAssetId;

  /** Role for risk calculation */
  role: RiskAssetRole;

  /** Human-readable name for display */
  displayName: string;
}
