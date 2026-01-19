/**
 * Swap Transaction API Types
 *
 * Types for building swap transactions via ParaSwap.
 * Returns transaction calldata ready for wallet signing.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';
import { PARASWAP_SUPPORTED_CHAIN_IDS, type ParaswapSupportedChainId } from './tokens.js';
import type { ParaswapPriceRoute } from './quote.js';

/**
 * POST /api/v1/swap/transaction - Request body
 */
export interface BuildSwapTransactionRequest {
  /**
   * EVM chain ID
   */
  chainId: number;

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
   * Expected destination amount in wei (from quote)
   */
  destAmount: string;

  /**
   * Slippage tolerance in basis points (e.g., 50 = 0.5%)
   */
  slippageBps: number;

  /**
   * User wallet address that will execute the swap
   */
  userAddress: string;

  /**
   * Price route from quote response (required for building transaction)
   */
  priceRoute: ParaswapPriceRoute;
}

/**
 * POST /api/v1/swap/transaction - Request validation
 *
 * Note: The priceRoute schema uses passthrough() to allow additional fields
 * that ParaSwap might return. This prevents validation failures when ParaSwap
 * adds new fields to their API response.
 */
export const BuildSwapTransactionRequestSchema = z.object({
  chainId: z
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
  destToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid destination token address'),
  srcAmount: z.string().min(1, 'Source amount is required'),
  destAmount: z.string().min(1, 'Destination amount is required'),
  slippageBps: z
    .number()
    .int('Slippage must be an integer')
    .min(1, 'Slippage must be at least 1 bps (0.01%)')
    .max(5000, 'Slippage cannot exceed 5000 bps (50%)'),
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid user address'),
  // Use passthrough to allow additional fields from ParaSwap API
  priceRoute: z
    .object({
      blockNumber: z.number(),
      network: z.number(),
      srcToken: z.string(),
      srcDecimals: z.number(),
      srcAmount: z.string(),
      destToken: z.string(),
      destDecimals: z.number(),
      destAmount: z.string(),
      bestRoute: z.array(z.unknown()),
      gasCostUSD: z.string(),
      gasCost: z.string(),
      side: z.string(),
      tokenTransferProxy: z.string(),
      contractAddress: z.string(),
      contractMethod: z.string(),
      srcUSD: z.string(),
      destUSD: z.string(),
      partner: z.string(),
      partnerFee: z.number(),
      maxImpactReached: z.boolean(),
      hmac: z.string(),
    })
    .passthrough(),
});

/**
 * Swap transaction data ready for wallet signing
 */
export interface SwapTransactionData {
  /**
   * Transaction target address (Augustus Swapper)
   */
  to: string;

  /**
   * Encoded swap calldata
   */
  data: string;

  /**
   * ETH value to send (usually "0" for ERC20 swaps)
   */
  value: string;

  /**
   * Estimated gas limit
   */
  gasLimit: string;

  /**
   * Minimum destination amount after slippage
   */
  minDestAmount: string;

  /**
   * Transaction deadline (Unix timestamp)
   * Transaction will revert if executed after this time.
   */
  deadline: number;
}

/**
 * POST /api/v1/swap/transaction - Response
 */
export interface BuildSwapTransactionResponse extends ApiResponse<SwapTransactionData> {
  meta?: {
    chainId: number;
    timestamp: string;
  };
}
