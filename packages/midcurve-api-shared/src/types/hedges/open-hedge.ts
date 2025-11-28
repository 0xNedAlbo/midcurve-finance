/**
 * Open Hyperliquid Hedge API Types
 *
 * Types and schemas for the POST /api/v1/hedges/hyperliquid/open endpoint.
 * This endpoint handles the complete hedge opening flow via backend signing.
 */

import { z } from 'zod';

// =============================================================================
// Request Types
// =============================================================================

/**
 * Request body schema for opening a Hyperliquid hedge
 *
 * All signing happens on the backend using the user's stored API wallet.
 */
export const OpenHyperliquidHedgeRequestSchema = z.object({
  /** Position hash to link the hedge to (e.g., "uniswapv3/8453/5374877") */
  positionHash: z.string().min(1),

  /** Leverage multiplier (1x to maxLeverage) */
  leverage: z.number().int().min(1).max(100),

  /** Bias percentage adjustment (-20 to +20, 0 = 1:1 hedge) */
  biasPercent: z.number().min(-20).max(20),

  /** Margin mode (only isolated supported currently) */
  marginMode: z.literal('isolated'),

  /** Coin symbol on Hyperliquid (e.g., "ETH", "BTC") */
  coin: z.string().min(1),

  /** Hedge size in base asset (e.g., "1.5" for 1.5 ETH) */
  hedgeSize: z.string().min(1),

  /** Notional value in USD (e.g., "5000.00") */
  notionalValueUsd: z.string().min(1),

  /** Current mark price for the order (e.g., "3200.50") */
  markPrice: z.string().min(1),
});

export type OpenHyperliquidHedgeRequest = z.infer<
  typeof OpenHyperliquidHedgeRequestSchema
>;

// =============================================================================
// Response Types
// =============================================================================

/**
 * Successful response from opening a Hyperliquid hedge
 */
export interface OpenHyperliquidHedgeResponse {
  /** Subaccount address used for the hedge */
  subaccountAddress: string;

  /** Subaccount name (e.g., "mc-uniswapv3/8453/5374877") */
  subaccountName: string;

  /** Order ID from Hyperliquid */
  orderId: number;

  /** Average fill price */
  fillPrice: string;

  /** Filled size in base asset */
  fillSize: string;

  /** Amount of USD transferred to subaccount as margin */
  marginTransferred: string;

  /** Market symbol (e.g., "ETH-USD") */
  market: string;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes specific to hedge opening
 */
export type OpenHedgeErrorCode =
  /** User has no API wallet registered */
  | 'NO_API_WALLET'
  /** API wallet has expired */
  | 'WALLET_EXPIRED'
  /** Not enough USD in main Hyperliquid account */
  | 'INSUFFICIENT_BALANCE'
  /** Order was rejected by Hyperliquid */
  | 'ORDER_REJECTED'
  /** Order did not fill within timeout */
  | 'ORDER_TIMEOUT'
  /** Failed to prepare subaccount */
  | 'SUBACCOUNT_ERROR'
  /** General hedge opening error */
  | 'HEDGE_OPEN_ERROR';

/**
 * Error response structure for hedge opening failures
 */
export interface OpenHedgeErrorResponse {
  /** Machine-readable error code */
  code: OpenHedgeErrorCode;

  /** Human-readable error message */
  message: string;

  /** Additional details (e.g., balance info for INSUFFICIENT_BALANCE) */
  details?: {
    /** Required amount */
    required?: string;
    /** Available amount */
    available?: string;
    /** Subaccount address (for partial failures) */
    subaccountAddress?: string;
  };
}
