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
 * - Validates addresses (EIP-55 checksumming)
 * - Handles RPC failures gracefully
 *
 * No caching: approval state is always read fresh from chain to avoid
 * stale data after approval transactions.
 */

import { normalizeAddress, isValidAddress } from '@midcurve/shared';
import { EvmConfig } from '../../config/evm.js';
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
}

/**
 * Service for checking ERC-721 NFT approval state
 */
export class Erc721ApprovalService {
  private readonly evmConfig: EvmConfig;
  private readonly logger: ServiceLogger = createServiceLogger('Erc721ApprovalService');

  constructor(dependencies: Erc721ApprovalServiceDependencies = {}) {
    this.evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
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
    const approvedAddress = await this.fetchGetApprovedFromRPC(tokenAddress, chainId, tokenId);

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
    const isApproved = await this.fetchIsApprovedForAllFromRPC(
      tokenAddress,
      ownerAddress,
      operatorAddress,
      chainId
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
}
