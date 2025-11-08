/**
 * Token Balance API Types
 *
 * Types for fetching ERC-20 token balances for user wallets.
 * Used by the token balance API endpoint that replaces frontend RPC calls.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

/**
 * Query parameters for token balance endpoint
 *
 * GET /api/v1/tokens/erc20/balance?walletAddress=0x...&tokenAddress=0x...&chainId=1
 */
export const GetTokenBalanceQuerySchema = z.object({
  /**
   * Wallet address to check balance for (will be normalized with EIP-55)
   * Example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
   */
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),

  /**
   * ERC-20 token contract address (will be normalized with EIP-55)
   * Example: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" (WETH)
   */
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),

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

/**
 * Token balance data returned by API
 *
 * All addresses are EIP-55 checksummed.
 * Balance is returned as string (BigInt serialized for JSON compatibility).
 */
export interface TokenBalanceData {
  /**
   * Wallet address (EIP-55 checksummed)
   */
  walletAddress: string;

  /**
   * ERC-20 token contract address (EIP-55 checksummed)
   */
  tokenAddress: string;

  /**
   * EVM chain ID
   */
  chainId: number;

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
   * Useful for debugging cache behavior
   */
  cached: boolean;
}

/**
 * Standard API response wrapper for token balance endpoint
 */
export type GetTokenBalanceResponse = ApiResponse<TokenBalanceData>;
