/**
 * Register Hyperliquid API Wallet Types
 *
 * Types for the wallet registration endpoint.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

/**
 * Hyperliquid environment
 */
export type HyperliquidEnvironment = 'mainnet' | 'testnet';

/**
 * Request to register a new Hyperliquid API wallet
 */
export interface RegisterHyperliquidWalletRequest {
  /**
   * Private key in 0x-prefixed hex format (66 characters)
   */
  privateKey: string;

  /**
   * User-friendly label for the wallet
   */
  label: string;

  /**
   * Hyperliquid environment (optional, defaults to mainnet)
   */
  environment?: HyperliquidEnvironment;

  /**
   * When the API wallet expires (ISO string)
   * Hyperliquid default is 180 days from creation
   */
  expiresAt: string;

  /**
   * User confirmation that they understand the risks
   */
  confirmed: boolean;
}

/**
 * Wallet data returned after registration
 */
export interface RegisterHyperliquidWalletData {
  /**
   * Wallet record ID
   */
  id: string;

  /**
   * Public wallet address (EIP-55 checksummed)
   */
  walletAddress: string;

  /**
   * User-friendly label
   */
  label: string;

  /**
   * Hyperliquid environment
   */
  environment: HyperliquidEnvironment;

  /**
   * When the API wallet expires (ISO string)
   */
  expiresAt: string;
}

/**
 * POST /api/v1/user/hyperliquid-wallets response
 */
export type RegisterHyperliquidWalletResponse =
  ApiResponse<RegisterHyperliquidWalletData>;

/**
 * Validation schema for wallet registration
 */
export const registerHyperliquidWalletSchema = z.object({
  privateKey: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{64}$/,
      'Invalid private key format. Must be 0x followed by 64 hex characters.'
    ),
  label: z
    .string()
    .min(1, 'Label is required')
    .max(50, 'Label must be 50 characters or less'),
  environment: z.enum(['mainnet', 'testnet']).optional().default('mainnet'),
  expiresAt: z.string().datetime({ message: 'Invalid expiration date format' }),
  confirmed: z
    .boolean()
    .refine((v) => v === true, 'You must confirm to proceed'),
});
