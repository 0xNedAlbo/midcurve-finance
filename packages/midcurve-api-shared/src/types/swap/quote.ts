/**
 * Swap Quote API Types
 *
 * Types for fetching swap quotes from ParaSwap.
 * Quotes include exchange rates, price impact, gas costs, and expiration.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';
import { PARASWAP_SUPPORTED_CHAIN_IDS, type ParaswapSupportedChainId } from './tokens.js';

/**
 * Swap side determines which amount is fixed:
 * - SELL: Fixed source amount (how much to sell)
 * - BUY: Fixed destination amount (how much to buy)
 */
export type SwapSide = 'SELL' | 'BUY';

/**
 * GET /api/v1/swap/quote - Query params
 */
export interface GetSwapQuoteQuery {
  /**
   * EVM chain ID (must be ParaSwap-supported)
   */
  chainId: number;

  /**
   * Source token address (token to sell)
   */
  srcToken: string;

  /**
   * Source token decimals
   */
  srcDecimals: number;

  /**
   * Destination token address (token to buy)
   */
  destToken: string;

  /**
   * Destination token decimals
   */
  destDecimals: number;

  /**
   * Amount to swap in wei.
   * - For SELL side: source token amount (how much to sell)
   * - For BUY side: destination token amount (how much to buy)
   */
  amount: string;

  /**
   * User wallet address that will execute the swap
   */
  userAddress: string;

  /**
   * Swap side (optional, defaults to SELL)
   * - SELL: Fixed source amount
   * - BUY: Fixed destination amount
   */
  side?: SwapSide;
}

/**
 * GET /api/v1/swap/quote - Query validation
 */
export const GetSwapQuoteQuerySchema = z.object({
  chainId: z.coerce
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive')
    .refine(
      (val) => PARASWAP_SUPPORTED_CHAIN_IDS.includes(val as ParaswapSupportedChainId),
      {
        message: `Chain not supported for swaps. Supported chains: ${PARASWAP_SUPPORTED_CHAIN_IDS.join(', ')}`,
      }
    ),
  srcToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid source token address'),
  srcDecimals: z.coerce.number().int().min(0).max(18),
  destToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid destination token address'),
  destDecimals: z.coerce.number().int().min(0).max(18),
  amount: z.string().min(1, 'Amount is required'),
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid user address'),
  side: z.enum(['SELL', 'BUY']).optional().default('SELL'),
  slippageBps: z.coerce
    .number()
    .int()
    .min(1, 'Slippage must be at least 1 bps (0.01%)')
    .max(5000, 'Slippage cannot exceed 5000 bps (50%)')
    .optional(),
});

/**
 * ParaSwap price route (opaque object passed to transaction building)
 * This is returned from ParaSwap's /prices endpoint and must be passed
 * to the /transactions endpoint to build the swap calldata.
 */
export interface ParaswapPriceRoute {
  blockNumber: number;
  network: number;
  srcToken: string;
  srcDecimals: number;
  srcAmount: string;
  destToken: string;
  destDecimals: number;
  destAmount: string;
  bestRoute: unknown[];
  gasCostUSD: string;
  gasCost: string;
  side: string;
  tokenTransferProxy: string;
  contractAddress: string;
  contractMethod: string;
  srcUSD: string;
  destUSD: string;
  partner: string;
  partnerFee: number;
  maxImpactReached: boolean;
  hmac: string;
}

/**
 * Swap quote data returned by API
 */
export interface SwapQuoteData {
  /**
   * Source token address
   */
  srcToken: string;

  /**
   * Destination token address
   */
  destToken: string;

  /**
   * Source amount in wei
   */
  srcAmount: string;

  /**
   * Expected destination amount in wei (before slippage)
   */
  destAmount: string;

  /**
   * Minimum destination amount after default slippage (0.5%)
   */
  minDestAmount: string;

  /**
   * Price impact as a decimal (e.g., 0.005 = 0.5%)
   * Negative values indicate favorable price
   */
  priceImpact: number;

  /**
   * Estimated gas cost in USD
   */
  gasCostUSD: string;

  /**
   * Estimated gas cost in wei
   */
  gasCostWei: string;

  /**
   * ParaSwap TokenTransferProxy address (for token approvals)
   */
  tokenTransferProxy: string;

  /**
   * ParaSwap Augustus Swapper address (swap contract)
   */
  augustusAddress: string;

  /**
   * Quote expiration timestamp (ISO 8601)
   * Frontend should disable swap and show "Refresh Quote" after this time.
   */
  expiresAt: string;

  /**
   * Price route data (opaque, pass to transaction building)
   */
  priceRoute: ParaswapPriceRoute;
}

/**
 * GET /api/v1/swap/quote - Response
 */
export interface GetSwapQuoteResponse extends ApiResponse<SwapQuoteData> {
  meta?: {
    chainId: number;
    timestamp: string;
  };
}
