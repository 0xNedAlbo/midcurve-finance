/**
 * Hyperliquid Perpetual Hedge Configuration (Immutable)
 * Stored in Hedge.config JSON field
 *
 * This is the TypeScript interface matching the Zod schema in @midcurve/services
 * for use across all packages without Zod dependency.
 */

/**
 * Account type on Hyperliquid
 */
export type HyperliquidAccountType =
  | 'main'
  | 'subaccount'
  | 'apiWallet'
  | 'multiSig';

/**
 * Margin mode for the hedge position
 */
export type HyperliquidMarginMode = 'cross' | 'isolated';

/**
 * Environment (mainnet or testnet)
 */
export type HyperliquidEnvironment = 'mainnet' | 'testnet';

/**
 * Account configuration for Hyperliquid
 */
export interface HyperliquidAccountConfig {
  /** EVM address used on Hyperliquid (master account) */
  userAddress: string;
  /** Type of account */
  accountType: HyperliquidAccountType;
  /** Subaccount address from Hyperliquid (immutable identifier) */
  subAccountAddress?: string;
  /** Subaccount name - current name on Hyperliquid (mc-{hash} or unused-{n}) */
  subAccountName?: string;
}

/**
 * Market configuration for the hedge
 */
export interface HyperliquidMarketConfig {
  /** Base asset symbol (e.g., "ETH") */
  coin: string;
  /** Quote asset symbol (e.g., "USD") */
  quote: string;
  /** Size decimals for the market */
  szDecimals?: number;
  /** Maximum leverage hint from the market */
  maxLeverageHint?: number;
  /** Margin table ID for the market */
  marginTableId?: number;
}

/**
 * Hedge parameters
 */
export interface HyperliquidHedgeParams {
  /** Direction - always 'short' for hedging */
  direction: 'short';
  /** Margin mode */
  marginMode: HyperliquidMarginMode;
  /** Target notional size in quote units (USD) */
  targetNotionalUsd: string;
  /** Target leverage */
  targetLeverage?: number;
  /** Whether to only reduce position (never increase) */
  reduceOnly: boolean;
}

/**
 * Risk limits for the hedge
 */
export interface HyperliquidRiskLimits {
  /** Maximum allowed leverage */
  maxLeverage?: number;
  /** Maximum position size in USD */
  maxSizeUsd?: string;
  /** Stop loss price */
  stopLossPx?: string;
  /** Take profit price */
  takeProfitPx?: string;
  /** Rebalance threshold in basis points (e.g., 500 = 5%) */
  rebalanceThresholdBps?: number;
}

/**
 * Links to the CL position being hedged
 */
export interface HyperliquidPositionLinks {
  /** Protocol of the linked position */
  positionProtocol?: 'uniswapv3';
  /** Chain ID of the linked position */
  positionChainId?: number;
  /** Pool address of the linked position */
  positionPoolAddress?: string;
  /** NFT ID of the linked position */
  positionNftId?: string;
}

/**
 * Hyperliquid Perpetual Hedge Configuration
 *
 * This is IMMUTABLE configuration set when the hedge is created.
 * Stored in Hedge.config JSON field.
 */
export interface HyperliquidPerpHedgeConfig {
  /** Schema version for migration support */
  schemaVersion: 1;

  /** Exchange identifier */
  exchange: 'hyperliquid';

  /** Environment (mainnet/testnet) */
  environment: HyperliquidEnvironment;

  /** DEX identifier (empty string for default perp DEX) */
  dex: string;

  /** Account configuration */
  account: HyperliquidAccountConfig;

  /** Market configuration */
  market: HyperliquidMarketConfig;

  /** Hedge parameters */
  hedgeParams: HyperliquidHedgeParams;

  /** Risk limits (optional) */
  riskLimits?: HyperliquidRiskLimits;

  /** Links to CL position (optional) */
  links?: HyperliquidPositionLinks;
}
