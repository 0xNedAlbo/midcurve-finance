/**
 * POST /api/automation/wallet - Get Automation Wallet Info with Balances
 *
 * Returns the user's automation wallet info including:
 * - Wallet address
 * - Balances per chain
 * - Recent activity (optional)
 *
 * Request:
 * - Authorization: X-Internal-API-Key header
 * - Body: { userId: string }
 *
 * Response:
 * - 200: { success: true, data: { walletAddress, balances: [...] } }
 * - 404: Wallet not found
 * - 401: Unauthorized
 * - 500: Server error
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPublicClient, http } from 'viem';
import { mainnet, arbitrum, base, bsc, polygon, optimism } from 'viem/chains';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import {
  automationWalletService,
  AutomationWalletServiceError,
} from '@/services/automation-wallet-service';

/**
 * Request body schema
 */
const GetWalletInfoSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

type GetWalletInfoRequest = z.infer<typeof GetWalletInfoSchema>;

/**
 * Chain configurations for fetching balances
 */
const CHAIN_CONFIGS = [
  { chainId: 1, chain: mainnet, symbol: 'ETH', rpcEnvVar: 'RPC_URL_ETHEREUM' },
  { chainId: 42161, chain: arbitrum, symbol: 'ETH', rpcEnvVar: 'RPC_URL_ARBITRUM' },
  { chainId: 8453, chain: base, symbol: 'ETH', rpcEnvVar: 'RPC_URL_BASE' },
  { chainId: 56, chain: bsc, symbol: 'BNB', rpcEnvVar: 'RPC_URL_BSC' },
  { chainId: 137, chain: polygon, symbol: 'MATIC', rpcEnvVar: 'RPC_URL_POLYGON' },
  { chainId: 10, chain: optimism, symbol: 'ETH', rpcEnvVar: 'RPC_URL_OPTIMISM' },
];

/**
 * Fetch balance for a single chain
 */
async function fetchChainBalance(
  walletAddress: `0x${string}`,
  chainConfig: (typeof CHAIN_CONFIGS)[number]
): Promise<{ chainId: number; balance: string; symbol: string; decimals: number } | null> {
  const rpcUrl = process.env[chainConfig.rpcEnvVar];
  if (!rpcUrl) {
    return null;
  }

  try {
    const client = createPublicClient({
      chain: chainConfig.chain,
      transport: http(rpcUrl),
    });

    const balance = await client.getBalance({ address: walletAddress });

    return {
      chainId: chainConfig.chainId,
      balance: balance.toString(),
      symbol: chainConfig.symbol,
      decimals: 18,
    };
  } catch (error) {
    console.error(`Failed to fetch balance for chain ${chainConfig.chainId}:`, error);
    return null;
  }
}

/**
 * POST /api/automation/wallet
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // Parse body
  const bodyResult = await parseJsonBody<GetWalletInfoRequest>(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_REQUEST',
        message: bodyResult.error,
        requestId,
      },
      { status: 400 }
    );
  }

  // Validate body
  const validation = GetWalletInfoSchema.safeParse(bodyResult.data);
  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'VALIDATION_ERROR',
        message: validation.error.issues.map((i) => i.message).join(', '),
        requestId,
      },
      { status: 400 }
    );
  }

  try {
    // Get wallet
    const wallet = await automationWalletService.getWalletByUserId(validation.data.userId);

    if (!wallet) {
      return NextResponse.json(
        {
          success: false,
          error: 'WALLET_NOT_FOUND',
          message: 'No automation wallet found for this user',
          requestId,
        },
        { status: 404 }
      );
    }

    // Fetch balances in parallel
    const balancePromises = CHAIN_CONFIGS.map((config) =>
      fetchChainBalance(wallet.walletAddress, config)
    );
    const balanceResults = await Promise.all(balancePromises);
    const balances = balanceResults.filter((b): b is NonNullable<typeof b> => b !== null);

    return NextResponse.json({
      success: true,
      data: {
        walletAddress: wallet.walletAddress,
        balances,
        recentActivity: [], // TODO: Implement activity tracking
      },
      requestId,
    });
  } catch (error) {
    if (error instanceof AutomationWalletServiceError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: error.message,
          requestId,
        },
        { status: error.statusCode }
      );
    }

    throw error;
  }
});
