/**
 * Intent Types for EVM Automation
 *
 * Intents are user-signed authorization documents that describe what automated
 * actions can be performed on behalf of the user. They are strategy-level
 * authorizations (not per-transaction).
 *
 * EIP-712 is used for human-readable signing in wallets.
 *
 * Example intents:
 * - "Close position NFT #12345 when price drops below 2000"
 * - "Keep position hedged with Hyperliquid short"
 * - "Collect fees and reinvest when accumulated > $100"
 */

import type { Address, Hex } from 'viem';

/**
 * Intent type discriminator
 */
export type IntentType =
  | 'close-position'
  | 'hedge-position'
  | 'collect-fees'
  | 'rebalance-position'
  | 'test-wallet';

/**
 * Base intent structure (all intents include these fields)
 */
export interface BaseIntent {
  /** Intent type discriminator */
  intentType: IntentType;
  /** Signer's wallet address */
  signer: Address;
  /** Target chain ID for execution */
  chainId: number;
  /** Unique nonce to prevent replay attacks */
  nonce: string;
  /** ISO timestamp when intent was signed */
  signedAt: string;
  /** ISO timestamp when intent expires (optional) */
  expiresAt?: string;
}

/**
 * Intent to close a Uniswap V3 position
 */
export interface ClosePositionIntent extends BaseIntent {
  intentType: 'close-position';
  /** The NFT token ID of the position */
  positionNftId: string;
  /** Optional: Close when price drops below this (in quote token) */
  priceTrigger?: {
    /** Trigger direction */
    direction: 'below' | 'above';
    /** Price threshold */
    price: string;
    /** Quote token symbol for clarity */
    quoteToken: string;
  };
}

/**
 * Intent to maintain a hedge for a position
 */
export interface HedgePositionIntent extends BaseIntent {
  intentType: 'hedge-position';
  /** The NFT token ID of the position */
  positionNftId: string;
  /** Hedge platform (e.g., 'hyperliquid') */
  hedgePlatform: string;
  /** Target hedge ratio (e.g., 1.0 for 100% hedged) */
  hedgeRatio: string;
  /** Maximum deviation from target before rebalancing */
  maxDeviation: string;
}

/**
 * Intent to collect fees from a position
 */
export interface CollectFeesIntent extends BaseIntent {
  intentType: 'collect-fees';
  /** The NFT token ID of the position */
  positionNftId: string;
  /** Optional: Only collect if accumulated fees > threshold */
  minFeesUsd?: string;
  /** Destination address for collected fees */
  recipient: Address;
}

/**
 * Intent to rebalance a position
 */
export interface RebalancePositionIntent extends BaseIntent {
  intentType: 'rebalance-position';
  /** The NFT token ID of the position */
  positionNftId: string;
  /** New lower tick (optional, keep current if not specified) */
  newTickLower?: number;
  /** New upper tick (optional, keep current if not specified) */
  newTickUpper?: number;
  /** Trigger conditions for rebalance */
  trigger?: {
    /** Rebalance when price deviates from center by this % */
    priceDeviationPercent?: string;
    /** Rebalance when out of range for this duration (seconds) */
    outOfRangeDuration?: number;
  };
}

/**
 * Test intent for wallet verification
 */
export interface TestWalletIntent extends BaseIntent {
  intentType: 'test-wallet';
  /** Test message to sign */
  message: string;
}

/**
 * Union of all intent types
 */
export type Intent =
  | ClosePositionIntent
  | HedgePositionIntent
  | CollectFeesIntent
  | RebalancePositionIntent
  | TestWalletIntent;

/**
 * Signed intent (intent + signature)
 */
export interface SignedIntent<T extends Intent = Intent> {
  /** The intent document */
  intent: T;
  /** EIP-712 signature of the intent */
  signature: Hex;
}

/**
 * EIP-712 domain for intent signing
 */
export interface IntentEIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/**
 * Default EIP-712 domain for Midcurve intents
 */
export const INTENT_EIP712_DOMAIN_NAME = 'Midcurve Intent';
export const INTENT_EIP712_DOMAIN_VERSION = '1';
