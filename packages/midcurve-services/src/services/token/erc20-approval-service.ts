/**
 * Erc20ApprovalService
 *
 * Service for checking ERC-20 token approval (allowance) state.
 * Implements backend-first architecture: all RPC calls happen server-side.
 *
 * Features:
 * - Reads allowance via viem PublicClient (RPC)
 * - Caches results in PostgreSQL (30-second TTL)
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
 * Maximum uint256 value for unlimited approval check
 */
const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * ERC-20 approval (allowance) data returned from service
 */
export interface Erc20Approval {
  /** Token contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Owner address (EIP-55 checksummed) */
  ownerAddress: string;
  /** Spender address (EIP-55 checksummed) */
  spenderAddress: string;
  /** Chain ID */
  chainId: number;
  /** Approved allowance amount */
  allowance: bigint;
  /** Whether unlimited approval is set (allowance >= MAX_UINT256) */
  isUnlimited: boolean;
  /** Whether any approval exists (allowance > 0) */
  hasApproval: boolean;
  /** Timestamp when data was fetched */
  timestamp: Date;
}

/**
 * Dependencies for Erc20ApprovalService
 */
export interface Erc20ApprovalServiceDependencies {
  /**
   * EVM configuration for chain RPC access
   * If not provided, the singleton EvmConfig instance will be used
   */
  evmConfig?: EvmConfig;

  /**
   * Cache service for approval caching
   * If not provided, the singleton CacheService instance will be used
   */
  cacheService?: CacheService;
}

/**
 * Service for checking ERC-20 token approval (allowance) state
 */
export class Erc20ApprovalService {
  private readonly evmConfig: EvmConfig;
  private readonly cacheService: CacheService;
  private readonly logger: ServiceLogger = createServiceLogger('Erc20ApprovalService');

  /**
   * Cache TTL for approval data (30 seconds)
   */
  private static readonly CACHE_TTL_SECONDS = 30;

  constructor(dependencies: Erc20ApprovalServiceDependencies = {}) {
    this.evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this.cacheService = dependencies.cacheService ?? CacheService.getInstance();
  }

  /**
   * Get ERC-20 token allowance for an owner/spender pair
   *
   * @param tokenAddress - ERC-20 token contract address (will be normalized)
   * @param ownerAddress - Token owner address (will be normalized)
   * @param spenderAddress - Spender address to check allowance for (will be normalized)
   * @param chainId - EVM chain ID
   * @returns Approval data with allowance amount
   *
   * @throws Error if addresses are invalid
   * @throws Error if chain is not supported
   * @throws Error if RPC call fails
   *
   * @example
   * ```typescript
   * const service = new Erc20ApprovalService();
   * const approval = await service.getAllowance(
   *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
   *   '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', // owner
   *   '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // spender (Uniswap V3 NFPM)
   *   1
   * );
   * console.log(approval.allowance); // 1000000000n (1000 USDC)
   * console.log(approval.hasApproval); // true
   * ```
   */
  async getAllowance(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
    chainId: number
  ): Promise<Erc20Approval> {
    // 1. Validate addresses
    if (!isValidAddress(tokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress}`);
    }
    if (!isValidAddress(ownerAddress)) {
      throw new Error(`Invalid owner address: ${ownerAddress}`);
    }
    if (!isValidAddress(spenderAddress)) {
      throw new Error(`Invalid spender address: ${spenderAddress}`);
    }

    // 2. Normalize addresses (EIP-55 checksumming)
    const normalizedToken = normalizeAddress(tokenAddress);
    const normalizedOwner = normalizeAddress(ownerAddress);
    const normalizedSpender = normalizeAddress(spenderAddress);

    // 3. Check cache first
    const cacheKey = this.getCacheKey(normalizedToken, normalizedOwner, normalizedSpender, chainId);
    const cached = await this.cacheService.get<string>(cacheKey);

    if (cached) {
      log.cacheHit(this.logger, 'erc20-approval', cacheKey);
      const allowance = BigInt(cached);
      return {
        tokenAddress: normalizedToken,
        ownerAddress: normalizedOwner,
        spenderAddress: normalizedSpender,
        chainId,
        allowance,
        isUnlimited: allowance >= MAX_UINT256,
        hasApproval: allowance > 0n,
        timestamp: new Date(),
      };
    }

    log.cacheMiss(this.logger, 'erc20-approval', cacheKey);

    // 4. Fetch allowance from RPC
    const allowance = await this.fetchAllowanceFromRPC(
      normalizedToken,
      normalizedOwner,
      normalizedSpender,
      chainId
    );

    // 5. Cache the result (convert BigInt to string for storage)
    await this.cacheService.set(
      cacheKey,
      allowance.toString(),
      Erc20ApprovalService.CACHE_TTL_SECONDS
    );

    return {
      tokenAddress: normalizedToken,
      ownerAddress: normalizedOwner,
      spenderAddress: normalizedSpender,
      chainId,
      allowance,
      isUnlimited: allowance >= MAX_UINT256,
      hasApproval: allowance > 0n,
      timestamp: new Date(),
    };
  }

  /**
   * Fetch allowance from blockchain via RPC
   *
   * @private
   */
  private async fetchAllowanceFromRPC(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
    chainId: number
  ): Promise<bigint> {
    log.externalApiCall(this.logger, 'EVM RPC', 'allowance', {
      tokenAddress,
      ownerAddress,
      spenderAddress,
      chainId,
    });

    try {
      // Get public client for the chain
      const client = this.evmConfig.getPublicClient(chainId);

      // Read allowance from ERC-20 contract
      const allowance = await client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [ownerAddress as `0x${string}`, spenderAddress as `0x${string}`],
      });

      this.logger.debug(
        {
          tokenAddress,
          ownerAddress,
          spenderAddress,
          chainId,
          allowance: allowance.toString(),
        },
        'Successfully fetched ERC-20 allowance'
      );

      return allowance as bigint;
    } catch (error) {
      log.methodError(
        this.logger,
        'fetchAllowanceFromRPC',
        error as Error,
        {
          tokenAddress,
          ownerAddress,
          spenderAddress,
          chainId,
        }
      );

      // Re-throw with more context
      throw new Error(
        `Failed to fetch ERC-20 allowance: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Generate cache key for approval data
   *
   * Format: erc20-approval:{chainId}:{tokenAddress}:{ownerAddress}:{spenderAddress}
   *
   * @private
   */
  private getCacheKey(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
    chainId: number
  ): string {
    return `erc20-approval:${chainId}:${tokenAddress}:${ownerAddress}:${spenderAddress}`;
  }

  /**
   * Clear cached approval for specific token/owner/spender/chain
   *
   * Useful after approval transactions to force immediate refresh
   *
   * @param tokenAddress - ERC-20 token contract address
   * @param ownerAddress - Token owner address
   * @param spenderAddress - Spender address
   * @param chainId - EVM chain ID
   */
  async invalidateCache(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
    chainId: number
  ): Promise<void> {
    const normalizedToken = normalizeAddress(tokenAddress);
    const normalizedOwner = normalizeAddress(ownerAddress);
    const normalizedSpender = normalizeAddress(spenderAddress);
    const cacheKey = this.getCacheKey(normalizedToken, normalizedOwner, normalizedSpender, chainId);

    await this.cacheService.delete(cacheKey);

    this.logger.debug(
      {
        cacheKey,
        tokenAddress: normalizedToken,
        ownerAddress: normalizedOwner,
        spenderAddress: normalizedSpender,
        chainId,
      },
      'Cache invalidated for ERC-20 approval'
    );
  }
}
