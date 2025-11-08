/**
 * UserTokenBalanceService
 *
 * Service for fetching ERC-20 token balances for user wallets.
 * Implements backend-first architecture: all RPC calls happen server-side.
 *
 * Features:
 * - Reads balances via viem PublicClient (RPC)
 * - Caches results in PostgreSQL (20-second TTL)
 * - Validates addresses (EIP-55 checksumming)
 * - Handles RPC failures gracefully
 */

import { erc20Abi } from 'viem';
import { normalizeAddress, isValidAddress } from '@midcurve/shared';
import { EvmConfig } from '../../config/evm.js';
import { CacheService } from '../cache/index.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Token balance data returned from service
 */
export interface TokenBalance {
  walletAddress: string; // EIP-55 checksummed
  tokenAddress: string; // EIP-55 checksummed
  chainId: number;
  balance: bigint;
  timestamp: Date;
}

/**
 * Dependencies for UserTokenBalanceService
 */
export interface UserTokenBalanceServiceDependencies {
  /**
   * EVM configuration for chain RPC access
   * If not provided, the singleton EvmConfig instance will be used
   */
  evmConfig?: EvmConfig;

  /**
   * Cache service for balance caching
   * If not provided, the singleton CacheService instance will be used
   */
  cacheService?: CacheService;
}

/**
 * Service for fetching and caching ERC-20 token balances
 */
export class UserTokenBalanceService {
  private readonly evmConfig: EvmConfig;
  private readonly cacheService: CacheService;
  private readonly logger: ServiceLogger = createServiceLogger('UserTokenBalanceService');

  /**
   * Cache TTL for token balances (20 seconds to match frontend polling)
   */
  private static readonly CACHE_TTL_SECONDS = 20;

  constructor(dependencies: UserTokenBalanceServiceDependencies = {}) {
    this.evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this.cacheService =
      dependencies.cacheService ?? CacheService.getInstance();
  }

  /**
   * Get token balance for a wallet address
   *
   * @param walletAddress - User's wallet address (will be normalized)
   * @param tokenAddress - ERC-20 token contract address (will be normalized)
   * @param chainId - EVM chain ID
   * @returns Token balance data with BigInt balance
   *
   * @throws Error if addresses are invalid
   * @throws Error if chain is not supported
   * @throws Error if RPC call fails
   *
   * @example
   * ```typescript
   * const service = new UserTokenBalanceService();
   * const balance = await service.getBalance(
   *   '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
   *   '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
   *   1
   * );
   * console.log(balance.balance); // 1500000000000000000n (1.5 WETH)
   * ```
   */
  async getBalance(
    walletAddress: string,
    tokenAddress: string,
    chainId: number
  ): Promise<TokenBalance> {
    // 1. Validate addresses
    if (!isValidAddress(walletAddress)) {
      throw new Error(`Invalid wallet address: ${walletAddress}`);
    }
    if (!isValidAddress(tokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress}`);
    }

    // 2. Normalize addresses (EIP-55 checksumming)
    const normalizedWallet = normalizeAddress(walletAddress);
    const normalizedToken = normalizeAddress(tokenAddress);

    // 3. Check cache first
    const cacheKey = this.getCacheKey(normalizedWallet, normalizedToken, chainId);
    const cached = await this.cacheService.get<string>(cacheKey);

    if (cached) {
      log.cacheHit(this.logger, 'token-balance', cacheKey);
      return {
        walletAddress: normalizedWallet,
        tokenAddress: normalizedToken,
        chainId,
        balance: BigInt(cached),
        timestamp: new Date(),
      };
    }

    log.cacheMiss(this.logger, 'token-balance', cacheKey);

    // 4. Fetch balance from RPC
    const balance = await this.fetchBalanceFromRPC(
      normalizedWallet,
      normalizedToken,
      chainId
    );

    // 5. Cache the result (convert BigInt to string for storage)
    await this.cacheService.set(
      cacheKey,
      balance.toString(),
      UserTokenBalanceService.CACHE_TTL_SECONDS
    );

    return {
      walletAddress: normalizedWallet,
      tokenAddress: normalizedToken,
      chainId,
      balance,
      timestamp: new Date(),
    };
  }

  /**
   * Fetch balance from blockchain via RPC
   *
   * @private
   */
  private async fetchBalanceFromRPC(
    walletAddress: string,
    tokenAddress: string,
    chainId: number
  ): Promise<bigint> {
    log.externalApiCall(this.logger, 'EVM RPC', 'balanceOf', {
      walletAddress,
      tokenAddress,
      chainId,
    });

    try {
      // Get public client for the chain
      const client = this.evmConfig.getPublicClient(chainId);

      // Read balanceOf from ERC-20 contract
      const balance = await client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`],
      });

      this.logger.debug(
        {
          walletAddress,
          tokenAddress,
          chainId,
          balance: balance.toString(),
        },
        'Successfully fetched token balance'
      );

      return balance as bigint;
    } catch (error) {
      log.methodError(
        this.logger,
        'fetchBalanceFromRPC',
        error as Error,
        {
          walletAddress,
          tokenAddress,
          chainId,
        }
      );

      // Re-throw with more context
      throw new Error(
        `Failed to fetch token balance: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Generate cache key for balance data
   *
   * Format: token-balance:{chainId}:{tokenAddress}:{walletAddress}
   *
   * @private
   */
  private getCacheKey(
    walletAddress: string,
    tokenAddress: string,
    chainId: number
  ): string {
    return `token-balance:${chainId}:${tokenAddress}:${walletAddress}`;
  }

  /**
   * Clear cached balance for specific wallet/token/chain
   *
   * Useful after transactions to force immediate refresh
   *
   * @param walletAddress - User's wallet address
   * @param tokenAddress - ERC-20 token contract address
   * @param chainId - EVM chain ID
   */
  async invalidateCache(
    walletAddress: string,
    tokenAddress: string,
    chainId: number
  ): Promise<void> {
    const normalizedWallet = normalizeAddress(walletAddress);
    const normalizedToken = normalizeAddress(tokenAddress);
    const cacheKey = this.getCacheKey(normalizedWallet, normalizedToken, chainId);

    await this.cacheService.delete(cacheKey);

    this.logger.debug(
      { cacheKey, walletAddress: normalizedWallet, tokenAddress: normalizedToken, chainId },
      'Cache invalidated for token balance'
    );
  }
}
