/**
 * Token Balance API Types
 *
 * Types for fetching ERC-20 token balances for user wallets.
 * Supports batch queries for multiple tokens in a single request.
 *
 * GET /api/v1/tokens/erc20/balance?walletAddress=0x...&tokenAddress=0x...&tokenAddress=0x...&chainId=1
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// ============================================================================
// Query Schema
// ============================================================================

/**
 * Query parameters for token balance endpoint
 *
 * Supports multiple tokenAddress params for batch queries:
 * GET /api/v1/tokens/erc20/balance?walletAddress=0x...&tokenAddress=0xA...&tokenAddress=0xB...&chainId=1
 */
export const GetTokenBalanceQuerySchema = z.object({
  /**
   * Wallet address to check balance for (will be normalized with EIP-55)
   * Example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
   */
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),

  /**
   * ERC-20 token contract address(es) - supports single or multiple
   * Single: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
   * Multiple: ["0xC02a...", "0xdAC1..."] (via repeated query params)
   */
  tokenAddress: z
    .union([
      z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
      z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address')),
    ])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .refine((arr) => arr.length >= 1, 'At least one token address required')
    .refine((arr) => arr.length <= 50, 'Maximum 50 token addresses per request'),

  /**
   * EVM chain ID
   * Example: 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: z.string().transform((val) => parseInt(val, 10)),
});

/**
 * Inferred TypeScript type from Zod schema
 */
export type GetTokenBalanceQuery = z.infer<typeof GetTokenBalanceQuerySchema>;

// ============================================================================
// Response Types
// ============================================================================

/**
 * Individual token balance item in batch response
 */
export interface TokenBalanceItem {
  /**
   * ERC-20 token contract address (EIP-55 checksummed)
   */
  tokenAddress: string;

  /**
   * Token balance in native token decimals (BigInt as string)
   * Example: "1500000000000000000" (1.5 tokens with 18 decimals)
   */
  balance: string;

  /**
   * Timestamp when balance was fetched
   */
  timestamp: string; // ISO 8601 format

  /**
   * Whether result came from cache
   */
  cached: boolean;

  /**
   * Error message if this specific token failed (null if successful)
   */
  error?: string | null;
}

/**
 * Batch token balance response data
 *
 * Returns balances for multiple tokens in a single response.
 */
export interface TokenBalanceBatchData {
  /**
   * Wallet address (EIP-55 checksummed)
   */
  walletAddress: string;

  /**
   * EVM chain ID
   */
  chainId: number;

  /**
   * Array of token balances (one per requested token)
   */
  balances: TokenBalanceItem[];
}

/**
 * Standard API response wrapper for batch token balance endpoint
 */
export type GetTokenBalanceResponse = ApiResponse<TokenBalanceBatchData>;

// ============================================================================
// Legacy Types (Deprecated)
// ============================================================================

/**
 * @deprecated Use TokenBalanceBatchData instead. Kept for backward compatibility.
 *
 * Single token balance data (old format before batch support).
 */
export interface TokenBalanceData {
  walletAddress: string;
  tokenAddress: string;
  chainId: number;
  balance: string;
  timestamp: string;
  cached: boolean;
}
