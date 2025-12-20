/**
 * POST /api/strategy/:addr/vault - Register a user-deployed vault
 *
 * After a user deploys their SimpleTokenVault on a public chain,
 * they call this endpoint to register it with the strategy.
 *
 * The endpoint validates:
 * - Strategy exists and has a fundingToken in manifest
 * - Vault contract exists on-chain at the specified address
 * - Vault token matches the manifest's fundingToken
 * - Vault operator matches the strategy's automation wallet
 * - Vault is not shutdown
 *
 * Request:
 * {
 *   vaultAddress: string,  // 0x... deployed vault address
 *   chainId: number,       // Public chain ID (1, 42161, etc.)
 * }
 *
 * Response (200):
 * {
 *   strategyId: string,
 *   vaultAddress: string,
 *   chainId: number,
 *   vaultToken: { id, symbol, decimals, address },
 *   operatorAddress: string,
 *   registeredAt: string,
 * }
 *
 * Response (4xx/5xx):
 * {
 *   error: string,
 *   code: string,
 * }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { type Address, createPublicClient, http, getAddress } from 'viem';
import { prisma } from '../../../../../lib/prisma';
import { logger } from '../../../../../lib/logger';
import type { StrategyManifest, FundingTokenSpec } from '../../../../../core/src/types/manifest';

// =============================================================================
// Constants
// =============================================================================

const log = logger.child({ route: 'POST /api/strategy/:addr/vault' });

/** Map of chain IDs to RPC URL environment variable names */
const RPC_URL_ENV_MAP: Record<number, string> = {
  1: 'RPC_URL_ETHEREUM',
  42161: 'RPC_URL_ARBITRUM',
  8453: 'RPC_URL_BASE',
  56: 'RPC_URL_BSC',
  137: 'RPC_URL_POLYGON',
  10: 'RPC_URL_OPTIMISM',
};

/** SimpleTokenVault ABI for validation calls */
const VAULT_VALIDATION_ABI = [
  { type: 'function', name: 'owner', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'operator', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'token', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'isShutdown', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
] as const;

/** ERC20 ABI for reading token metadata */
const ERC20_ABI = [
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
] as const;

// =============================================================================
// Request Schema
// =============================================================================

const RegisterVaultSchema = z.object({
  vaultAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid vault address format'),
  chainId: z.number().int().positive('Chain ID must be a positive integer'),
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a public client for reading from a public chain.
 */
function createChainClient(chainId: number) {
  const envVar = RPC_URL_ENV_MAP[chainId];
  if (!envVar) {
    throw Object.assign(
      new Error(`Unsupported chain ID: ${chainId}. Supported chains: ${Object.keys(RPC_URL_ENV_MAP).join(', ')}`),
      { code: 'UNSUPPORTED_CHAIN', statusCode: 400 }
    );
  }

  const rpcUrl = process.env[envVar];
  if (!rpcUrl) {
    throw Object.assign(
      new Error(`RPC URL not configured for chain ${chainId}. Set ${envVar} environment variable.`),
      { code: 'RPC_NOT_CONFIGURED', statusCode: 500 }
    );
  }

  return createPublicClient({
    transport: http(rpcUrl),
  });
}

/**
 * Normalize address to lowercase for comparison.
 */
function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

// =============================================================================
// Handler
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ addr: string }> }
) {
  try {
    const { addr: strategyId } = await params;

    // 1. Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_REQUEST' },
        { status: 400 }
      );
    }

    const parseResult = RegisterVaultSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'INVALID_REQUEST', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { vaultAddress: rawVaultAddress, chainId } = parseResult.data;
    const vaultAddress = normalizeAddress(rawVaultAddress) as Address;

    log.info({ strategyId, vaultAddress, chainId, msg: 'Registering vault' });

    // 2. Lookup strategy with manifest and automation wallet
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
      select: {
        id: true,
        manifest: true,
        vaultConfig: true,
        automationWallets: {
          where: { isActive: true },
          take: 1,
          select: {
            config: true,
          },
        },
      },
    });

    if (!strategy) {
      return NextResponse.json(
        { error: 'Strategy not found', code: 'STRATEGY_NOT_FOUND' },
        { status: 404 }
      );
    }

    // 3. Parse manifest and check for fundingToken
    const manifest = strategy.manifest as StrategyManifest | null;
    if (!manifest?.fundingToken) {
      return NextResponse.json(
        { error: 'Strategy does not require vault funding (no fundingToken in manifest)', code: 'NO_FUNDING_TOKEN' },
        { status: 400 }
      );
    }

    const fundingToken: FundingTokenSpec = manifest.fundingToken;

    // 4. Check vault not already registered
    if (strategy.vaultConfig) {
      return NextResponse.json(
        { error: 'Vault already registered for this strategy', code: 'VAULT_ALREADY_REGISTERED' },
        { status: 409 }
      );
    }

    // 5. Validate chainId matches manifest fundingToken chainId
    if (chainId !== fundingToken.chainId) {
      return NextResponse.json(
        {
          error: `Chain ID mismatch. Expected ${fundingToken.chainId} (from manifest), got ${chainId}`,
          code: 'CHAIN_MISMATCH',
        },
        { status: 400 }
      );
    }

    // 6. Get operator wallet address
    const wallet = strategy.automationWallets[0];
    const walletConfig = wallet?.config as { walletAddress?: string } | undefined;
    if (!walletConfig?.walletAddress) {
      return NextResponse.json(
        { error: 'Strategy has no active automation wallet', code: 'NO_OPERATOR_WALLET' },
        { status: 500 }
      );
    }
    const operatorAddress = normalizeAddress(walletConfig.walletAddress) as Address;

    // 7. Create public client and validate vault on-chain
    const client = createChainClient(chainId);

    let onChainToken: Address;
    let onChainOperator: Address;
    let isShutdown: boolean;

    try {
      [onChainToken, onChainOperator, isShutdown] = await Promise.all([
        client.readContract({
          address: vaultAddress,
          abi: VAULT_VALIDATION_ABI,
          functionName: 'token',
        }),
        client.readContract({
          address: vaultAddress,
          abi: VAULT_VALIDATION_ABI,
          functionName: 'operator',
        }),
        client.readContract({
          address: vaultAddress,
          abi: VAULT_VALIDATION_ABI,
          functionName: 'isShutdown',
        }),
      ]);
    } catch (error) {
      log.error({ error, vaultAddress, chainId, msg: 'Failed to read vault contract' });
      return NextResponse.json(
        {
          error: `Vault contract not found or not readable at ${vaultAddress} on chain ${chainId}`,
          code: 'VAULT_NOT_FOUND',
        },
        { status: 400 }
      );
    }

    // 8. Validate vault token matches manifest
    const expectedTokenAddress = normalizeAddress(fundingToken.address);
    if (normalizeAddress(onChainToken) !== expectedTokenAddress) {
      return NextResponse.json(
        {
          error: `Vault token mismatch. Expected ${fundingToken.address}, vault has ${onChainToken}`,
          code: 'VAULT_TOKEN_MISMATCH',
        },
        { status: 400 }
      );
    }

    // 9. Validate vault operator matches strategy operator
    if (normalizeAddress(onChainOperator) !== operatorAddress) {
      return NextResponse.json(
        {
          error: `Vault operator mismatch. Expected ${getAddress(operatorAddress)}, vault has ${onChainOperator}`,
          code: 'VAULT_OPERATOR_MISMATCH',
        },
        { status: 400 }
      );
    }

    // 10. Validate vault is not shutdown
    if (isShutdown) {
      return NextResponse.json(
        { error: 'Vault is already shutdown', code: 'VAULT_SHUTDOWN' },
        { status: 400 }
      );
    }

    // 11. Find or create Token record for vault token
    let token = await prisma.token.findFirst({
      where: {
        tokenType: 'evm-erc20',
        config: {
          path: ['address'],
          equals: expectedTokenAddress,
        },
      },
    });

    if (!token) {
      // Read token metadata from chain
      log.info({ tokenAddress: expectedTokenAddress, chainId, msg: 'Creating new token record' });

      let tokenName: string;
      let tokenSymbol: string;
      let tokenDecimals: number;

      try {
        [tokenName, tokenSymbol, tokenDecimals] = await Promise.all([
          client.readContract({
            address: onChainToken,
            abi: ERC20_ABI,
            functionName: 'name',
          }),
          client.readContract({
            address: onChainToken,
            abi: ERC20_ABI,
            functionName: 'symbol',
          }),
          client.readContract({
            address: onChainToken,
            abi: ERC20_ABI,
            functionName: 'decimals',
          }),
        ]);
      } catch (error) {
        log.error({ error, tokenAddress: onChainToken, msg: 'Failed to read token metadata' });
        return NextResponse.json(
          { error: `Failed to read token metadata from ${onChainToken}`, code: 'TOKEN_READ_FAILED' },
          { status: 500 }
        );
      }

      token = await prisma.token.create({
        data: {
          tokenType: 'evm-erc20',
          name: tokenName,
          symbol: tokenSymbol,
          decimals: tokenDecimals,
          config: {
            address: expectedTokenAddress,
            chainId,
          },
        },
      });

      log.info({ tokenId: token.id, symbol: tokenSymbol, msg: 'Token record created' });
    }

    // 12. Update Strategy with vault config
    const now = new Date();
    await prisma.strategy.update({
      where: { id: strategyId },
      data: {
        vaultConfig: {
          type: 'evm',
          chainId,
          vaultAddress,
        },
        vaultTokenId: token.id,
        vaultDeployedAt: now,
      },
    });

    log.info({ strategyId, vaultAddress, tokenId: token.id, msg: 'Vault registered successfully' });

    // 13. Return success response
    const tokenConfig = token.config as { address?: string } | undefined;

    return NextResponse.json({
      strategyId,
      vaultAddress: getAddress(vaultAddress),
      chainId,
      vaultToken: {
        id: token.id,
        symbol: token.symbol,
        decimals: token.decimals,
        address: tokenConfig?.address ? getAddress(tokenConfig.address) : null,
      },
      operatorAddress: getAddress(operatorAddress),
      registeredAt: now.toISOString(),
    });
  } catch (error) {
    log.error({ error, msg: 'Vault registration error' });

    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
    const code = (error as { code?: string })?.code ?? 'INTERNAL_ERROR';

    return NextResponse.json(
      { error: message, code },
      { status: statusCode }
    );
  }
}
