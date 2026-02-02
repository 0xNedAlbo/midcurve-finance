/**
 * Erc721ApprovalService
 *
 * Service for checking ERC-721 NFT approval state.
 * Implements backend-first architecture: all RPC calls happen server-side.
 *
 * Supports two approval modes:
 * - getApproved(tokenId): Check if a specific address is approved for a single NFT
 * - isApprovedForAll(owner, operator): Check if an operator is approved for all NFTs
 *
 * Features:
 * - Reads approval via viem PublicClient (RPC)
 * - Caches results in PostgreSQL (30-second TTL)
 * - Validates addresses (EIP-55 checksumming)
 * - Handles RPC failures gracefully
 */

import { normalizeAddress, isValidAddress } from '@midcurve/shared';
import { EvmConfig } from '../../config/evm.js';
import { CacheService } from '../cache/index.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * ERC-721 approval ABI for reading approval state
 */
const erc721ApprovalAbi = [
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'getApproved',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Zero address constant
 */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * ERC-721 approval data returned from service
 */
export interface Erc721Approval {
  /** NFT contract address (EIP-55 checksummed) */
  tokenAddress: string;
  /** Owner address (EIP-55 checksummed) */
  ownerAddress: string;
  /** Chain ID */
  chainId: number;
  /** Token ID if querying specific token approval */
  tokenId?: string;
  /** Operator address if querying isApprovedForAll */
  operatorAddress?: string;
  /** For specific token: the approved address (or null if none) */
  approvedAddress?: string | null;
  /** For operator approval: whether the operator is approved for all tokens */
  isApprovedForAll?: boolean;
  /** Whether any approval exists for this query */
  hasApproval: boolean;
  /** Timestamp when data was fetched */
  timestamp: Date;
}

/**
 * Options for getApproval method
 */
export interface Erc721ApprovalOptions {
  /**
   * Token ID to check approval for (uses getApproved)
   * If provided, checks the approved address for this specific token
   */
  tokenId?: string;

  /**
   * Operator address to check (uses isApprovedForAll)
   * If provided without tokenId, checks if operator is approved for all tokens
   */
  operatorAddress?: string;
}

/**
 * Dependencies for Erc721ApprovalService
 */
export interface Erc721ApprovalServiceDependencies {
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
 * Service for checking ERC-721 NFT approval state
 */
export class Erc721ApprovalService {
  private readonly evmConfig: EvmConfig;
  private readonly cacheService: CacheService;
  private readonly logger: ServiceLogger = createServiceLogger('Erc721ApprovalService');

  /**
   * Cache TTL for approval data (30 seconds)
   */
  private static readonly CACHE_TTL_SECONDS = 30;

  constructor(dependencies: Erc721ApprovalServiceDependencies = {}) {
    this.evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this.cacheService = dependencies.cacheService ?? CacheService.getInstance();
  }

  /**
   * Get ERC-721 NFT approval state
   *
   * Two modes of operation:
   * 1. With tokenId: Returns the approved address for that specific token
   * 2. With operatorAddress (no tokenId): Returns whether operator is approved for all
   *
   * @param tokenAddress - ERC-721 contract address (will be normalized)
   * @param ownerAddress - NFT owner address (will be normalized)
   * @param chainId - EVM chain ID
   * @param options - Query options (tokenId or operatorAddress)
   * @returns Approval data
   *
   * @throws Error if addresses are invalid
   * @throws Error if neither tokenId nor operatorAddress provided
   * @throws Error if chain is not supported
   * @throws Error if RPC call fails
   *
   * @example
   * ```typescript
   * const service = new Erc721ApprovalService();
   *
   * // Check approval for specific NFT
   * const tokenApproval = await service.getApproval(
   *   '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Uniswap V3 NFPM
   *   '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', // owner
   *   1,
   *   { tokenId: '12345' }
   * );
   * console.log(tokenApproval.approvedAddress); // '0x...' or null
   *
   * // Check if operator is approved for all
   * const operatorApproval = await service.getApproval(
   *   '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
   *   '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
   *   1,
   *   { operatorAddress: '0xPositionCloser...' }
   * );
   * console.log(operatorApproval.isApprovedForAll); // true or false
   * ```
   */
  async getApproval(
    tokenAddress: string,
    ownerAddress: string,
    chainId: number,
    options: Erc721ApprovalOptions
  ): Promise<Erc721Approval> {
    const { tokenId, operatorAddress } = options;

    // 1. Validate that at least one query option is provided
    if (!tokenId && !operatorAddress) {
      throw new Error('Either tokenId or operatorAddress must be provided');
    }

    // 2. Validate addresses
    if (!isValidAddress(tokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress}`);
    }
    if (!isValidAddress(ownerAddress)) {
      throw new Error(`Invalid owner address: ${ownerAddress}`);
    }
    if (operatorAddress && !isValidAddress(operatorAddress)) {
      throw new Error(`Invalid operator address: ${operatorAddress}`);
    }

    // 3. Normalize addresses (EIP-55 checksumming)
    const normalizedToken = normalizeAddress(tokenAddress);
    const normalizedOwner = normalizeAddress(ownerAddress);
    const normalizedOperator = operatorAddress ? normalizeAddress(operatorAddress) : undefined;

    // 4. Route to appropriate method based on options
    if (tokenId) {
      return this.getTokenApproval(normalizedToken, normalizedOwner, chainId, tokenId);
    } else {
      return this.getOperatorApproval(normalizedToken, normalizedOwner, chainId, normalizedOperator!);
    }
  }

  /**
   * Get approved address for a specific token ID
   *
   * @private
   */
  private async getTokenApproval(
    tokenAddress: string,
    ownerAddress: string,
    chainId: number,
    tokenId: string
  ): Promise<Erc721Approval> {
    // Check cache first
    const cacheKey = this.getTokenCacheKey(tokenAddress, chainId, tokenId);
    const cached = await this.cacheService.get<string | null>(cacheKey);

    if (cached !== undefined) {
      log.cacheHit(this.logger, 'erc721-token-approval', cacheKey);
      const approvedAddress = cached === ZERO_ADDRESS ? null : cached;
      return {
        tokenAddress,
        ownerAddress,
        chainId,
        tokenId,
        approvedAddress,
        hasApproval: approvedAddress !== null,
        timestamp: new Date(),
      };
    }

    log.cacheMiss(this.logger, 'erc721-token-approval', cacheKey);

    // Fetch from RPC
    const approvedAddress = await this.fetchGetApprovedFromRPC(tokenAddress, chainId, tokenId);

    // Cache the result
    await this.cacheService.set(
      cacheKey,
      approvedAddress ?? ZERO_ADDRESS,
      Erc721ApprovalService.CACHE_TTL_SECONDS
    );

    return {
      tokenAddress,
      ownerAddress,
      chainId,
      tokenId,
      approvedAddress,
      hasApproval: approvedAddress !== null,
      timestamp: new Date(),
    };
  }

  /**
   * Check if operator is approved for all tokens
   *
   * @private
   */
  private async getOperatorApproval(
    tokenAddress: string,
    ownerAddress: string,
    chainId: number,
    operatorAddress: string
  ): Promise<Erc721Approval> {
    // Check cache first
    const cacheKey = this.getOperatorCacheKey(tokenAddress, ownerAddress, chainId, operatorAddress);
    const cached = await this.cacheService.get<boolean>(cacheKey);

    if (cached !== null && cached !== undefined) {
      log.cacheHit(this.logger, 'erc721-operator-approval', cacheKey);
      return {
        tokenAddress,
        ownerAddress,
        chainId,
        operatorAddress,
        isApprovedForAll: cached,
        hasApproval: cached,
        timestamp: new Date(),
      };
    }

    log.cacheMiss(this.logger, 'erc721-operator-approval', cacheKey);

    // Fetch from RPC
    const isApproved = await this.fetchIsApprovedForAllFromRPC(
      tokenAddress,
      ownerAddress,
      operatorAddress,
      chainId
    );

    // Cache the result
    await this.cacheService.set(
      cacheKey,
      isApproved,
      Erc721ApprovalService.CACHE_TTL_SECONDS
    );

    return {
      tokenAddress,
      ownerAddress,
      chainId,
      operatorAddress,
      isApprovedForAll: isApproved,
      hasApproval: isApproved,
      timestamp: new Date(),
    };
  }

  /**
   * Fetch getApproved from blockchain via RPC
   *
   * @private
   */
  private async fetchGetApprovedFromRPC(
    tokenAddress: string,
    chainId: number,
    tokenId: string
  ): Promise<string | null> {
    log.externalApiCall(this.logger, 'EVM RPC', 'getApproved', {
      tokenAddress,
      tokenId,
      chainId,
    });

    try {
      const client = this.evmConfig.getPublicClient(chainId);

      const approved = await client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc721ApprovalAbi,
        functionName: 'getApproved',
        args: [BigInt(tokenId)],
      });

      const approvedAddress = approved as string;
      const result = approvedAddress === ZERO_ADDRESS ? null : approvedAddress;

      this.logger.debug(
        {
          tokenAddress,
          tokenId,
          chainId,
          approvedAddress: result,
        },
        'Successfully fetched ERC-721 getApproved'
      );

      return result;
    } catch (error) {
      log.methodError(
        this.logger,
        'fetchGetApprovedFromRPC',
        error as Error,
        {
          tokenAddress,
          tokenId,
          chainId,
        }
      );

      throw new Error(
        `Failed to fetch ERC-721 getApproved: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Fetch isApprovedForAll from blockchain via RPC
   *
   * @private
   */
  private async fetchIsApprovedForAllFromRPC(
    tokenAddress: string,
    ownerAddress: string,
    operatorAddress: string,
    chainId: number
  ): Promise<boolean> {
    log.externalApiCall(this.logger, 'EVM RPC', 'isApprovedForAll', {
      tokenAddress,
      ownerAddress,
      operatorAddress,
      chainId,
    });

    try {
      const client = this.evmConfig.getPublicClient(chainId);

      const isApproved = await client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc721ApprovalAbi,
        functionName: 'isApprovedForAll',
        args: [ownerAddress as `0x${string}`, operatorAddress as `0x${string}`],
      });

      this.logger.debug(
        {
          tokenAddress,
          ownerAddress,
          operatorAddress,
          chainId,
          isApproved,
        },
        'Successfully fetched ERC-721 isApprovedForAll'
      );

      return isApproved as boolean;
    } catch (error) {
      log.methodError(
        this.logger,
        'fetchIsApprovedForAllFromRPC',
        error as Error,
        {
          tokenAddress,
          ownerAddress,
          operatorAddress,
          chainId,
        }
      );

      throw new Error(
        `Failed to fetch ERC-721 isApprovedForAll: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Generate cache key for token-specific approval
   *
   * @private
   */
  private getTokenCacheKey(
    tokenAddress: string,
    chainId: number,
    tokenId: string
  ): string {
    return `erc721-token-approval:${chainId}:${tokenAddress}:${tokenId}`;
  }

  /**
   * Generate cache key for operator approval
   *
   * @private
   */
  private getOperatorCacheKey(
    tokenAddress: string,
    ownerAddress: string,
    chainId: number,
    operatorAddress: string
  ): string {
    return `erc721-operator-approval:${chainId}:${tokenAddress}:${ownerAddress}:${operatorAddress}`;
  }

  /**
   * Clear cached approval for specific token
   *
   * @param tokenAddress - ERC-721 contract address
   * @param chainId - EVM chain ID
   * @param tokenId - Token ID
   */
  async invalidateTokenCache(
    tokenAddress: string,
    chainId: number,
    tokenId: string
  ): Promise<void> {
    const normalizedToken = normalizeAddress(tokenAddress);
    const cacheKey = this.getTokenCacheKey(normalizedToken, chainId, tokenId);

    await this.cacheService.delete(cacheKey);

    this.logger.debug(
      { cacheKey, tokenAddress: normalizedToken, tokenId, chainId },
      'Cache invalidated for ERC-721 token approval'
    );
  }

  /**
   * Clear cached operator approval
   *
   * @param tokenAddress - ERC-721 contract address
   * @param ownerAddress - Token owner address
   * @param chainId - EVM chain ID
   * @param operatorAddress - Operator address
   */
  async invalidateOperatorCache(
    tokenAddress: string,
    ownerAddress: string,
    chainId: number,
    operatorAddress: string
  ): Promise<void> {
    const normalizedToken = normalizeAddress(tokenAddress);
    const normalizedOwner = normalizeAddress(ownerAddress);
    const normalizedOperator = normalizeAddress(operatorAddress);
    const cacheKey = this.getOperatorCacheKey(
      normalizedToken,
      normalizedOwner,
      chainId,
      normalizedOperator
    );

    await this.cacheService.delete(cacheKey);

    this.logger.debug(
      {
        cacheKey,
        tokenAddress: normalizedToken,
        ownerAddress: normalizedOwner,
        operatorAddress: normalizedOperator,
        chainId,
      },
      'Cache invalidated for ERC-721 operator approval'
    );
  }
}
