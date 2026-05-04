/**
 * Token Hash Utility
 *
 * Creates and parses tokenHash strings for fast indexed lookups.
 * The tokenHash format is: "{tokenType}/{...type-specific-fields}"
 *
 * Supported formats:
 * - ERC-20: "erc20/{chainId}/{address}" → { tokenType: 'erc20', chainId, address }
 * - ERC-721: "erc721/{chainId}/{contractAddress}/{tokenId}" → { tokenType: 'erc721', chainId, contractAddress, tokenId }
 * - Basic Currency: "basic-currency/{currencyCode}" → { tokenType: 'basic-currency', currencyCode }
 * - Staking Share: "staking-share/{chainId}/{vaultAddress}" → { tokenType: 'staking-share', chainId, vaultAddress }
 *
 * @example
 * ```typescript
 * const hash = createErc20TokenHash(42161, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
 * // "erc20/42161/0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
 *
 * const parsed = parseTokenHash(hash);
 * if (parsed.tokenType === 'erc20') {
 *   console.log(parsed.chainId, parsed.address); // Type-safe access
 * }
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parsed ERC-20 token hash
 */
export interface Erc20TokenHashData {
  tokenType: 'erc20';
  chainId: number;
  address: string;
}

/**
 * Parsed ERC-721 token hash
 */
export interface Erc721TokenHashData {
  tokenType: 'erc721';
  chainId: number;
  contractAddress: string;
  tokenId: string;
}

/**
 * Parsed basic currency token hash
 */
export interface BasicCurrencyTokenHashData {
  tokenType: 'basic-currency';
  currencyCode: string;
}

/**
 * Parsed staking-share token hash.
 *
 * Represents a synthetic share token for a single UniswapV3StakingVault clone.
 * Vault clones are owner-bound 1:1, so the vault address alone disambiguates.
 */
export interface StakingShareTokenHashData {
  tokenType: 'staking-share';
  chainId: number;
  vaultAddress: string;
}

/**
 * Discriminated union of all parsed token hash types.
 * Extend this union when adding new token type support.
 */
export type ParsedTokenHash =
  | Erc20TokenHashData
  | Erc721TokenHashData
  | BasicCurrencyTokenHashData
  | StakingShareTokenHashData;

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a token hash for an ERC-20 token.
 *
 * @param chainId - EVM chain ID (must be a positive integer)
 * @param address - EIP-55 normalized token contract address (caller must normalize)
 * @returns Token hash string in format "erc20/{chainId}/{address}"
 * @throws Error if chainId or address is invalid
 */
export function createErc20TokenHash(chainId: number, address: string): string {
  if (chainId === undefined || chainId === null) {
    throw new Error('chainId is required for ERC-20 token hash creation');
  }
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`chainId must be a positive integer, got ${chainId}`);
  }

  if (!address || typeof address !== 'string') {
    throw new Error('address is required for ERC-20 token hash creation');
  }
  if (!address.startsWith('0x') || address.length !== 42) {
    throw new Error(`address must be a valid 0x-prefixed 42-character hex string, got "${address}"`);
  }

  return `erc20/${chainId}/${address}`;
}

/**
 * Create a token hash for an ERC-721 NFT token.
 *
 * @param chainId - EVM chain ID (must be a positive integer)
 * @param contractAddress - EIP-55 normalized NFT contract address (caller must normalize)
 * @param tokenId - NFT token ID (string representation of uint256)
 * @returns Token hash string in format "erc721/{chainId}/{contractAddress}/{tokenId}"
 * @throws Error if any parameter is invalid
 */
export function createErc721TokenHash(
  chainId: number,
  contractAddress: string,
  tokenId: string
): string {
  if (chainId === undefined || chainId === null) {
    throw new Error('chainId is required for ERC-721 token hash creation');
  }
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`chainId must be a positive integer, got ${chainId}`);
  }

  if (!contractAddress || typeof contractAddress !== 'string') {
    throw new Error('contractAddress is required for ERC-721 token hash creation');
  }
  if (!contractAddress.startsWith('0x') || contractAddress.length !== 42) {
    throw new Error(
      `contractAddress must be a valid 0x-prefixed 42-character hex string, got "${contractAddress}"`
    );
  }

  if (!tokenId || typeof tokenId !== 'string') {
    throw new Error('tokenId is required for ERC-721 token hash creation');
  }

  return `erc721/${chainId}/${contractAddress}/${tokenId}`;
}

/**
 * Create a token hash for a basic currency token.
 *
 * @param currencyCode - Currency code (e.g., 'USD', 'ETH', 'BTC')
 * @returns Token hash string in format "basic-currency/{currencyCode}"
 * @throws Error if currencyCode is invalid
 */
export function createBasicCurrencyTokenHash(currencyCode: string): string {
  if (!currencyCode || typeof currencyCode !== 'string') {
    throw new Error('currencyCode is required for basic currency token hash creation');
  }

  return `basic-currency/${currencyCode}`;
}

/**
 * Create a token hash for a UniswapV3StakingVault staking share.
 *
 * Vault clones are owner-bound 1:1, so vaultAddress is the disambiguator.
 *
 * @param chainId - EVM chain ID (must be a positive integer)
 * @param vaultAddress - EIP-55 normalized vault contract address (caller must normalize)
 * @returns Token hash string in format "staking-share/{chainId}/{vaultAddress}"
 * @throws Error if any parameter is invalid
 */
export function createStakingShareTokenHash(chainId: number, vaultAddress: string): string {
  if (chainId === undefined || chainId === null) {
    throw new Error('chainId is required for staking-share token hash creation');
  }
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`chainId must be a positive integer, got ${chainId}`);
  }

  if (!vaultAddress || typeof vaultAddress !== 'string') {
    throw new Error('vaultAddress is required for staking-share token hash creation');
  }
  if (!vaultAddress.startsWith('0x') || vaultAddress.length !== 42) {
    throw new Error(
      `vaultAddress must be a valid 0x-prefixed 42-character hex string, got "${vaultAddress}"`
    );
  }

  return `staking-share/${chainId}/${vaultAddress}`;
}

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse a tokenHash string into a structured, type-specific object.
 *
 * @param hash - Token hash string (e.g. "erc20/1/0xA0b8...")
 * @returns Parsed token hash with type-specific fields
 * @throws Error if hash format is invalid or token type is unknown
 */
export function parseTokenHash(hash: string): ParsedTokenHash {
  if (!hash || typeof hash !== 'string') {
    throw new Error(`Invalid tokenHash: expected non-empty string, got ${typeof hash}`);
  }

  const parts = hash.split('/');
  if (parts.length < 2) {
    throw new Error(`Invalid tokenHash format: "${hash}" (expected "tokenType/...")`);
  }

  const tokenType = parts[0];

  switch (tokenType) {
    case 'erc20': {
      if (parts.length !== 3) {
        throw new Error(
          `Invalid erc20 tokenHash: "${hash}" (expected "erc20/{chainId}/{address}")`
        );
      }
      const chainId = Number(parts[1]);
      const address = parts[2]!;
      if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error(`Invalid chainId in tokenHash: "${parts[1]}"`);
      }
      if (!address.startsWith('0x') || address.length !== 42) {
        throw new Error(`Invalid address in tokenHash: "${parts[2]}"`);
      }
      return { tokenType: 'erc20', chainId, address };
    }

    case 'erc721': {
      if (parts.length !== 4) {
        throw new Error(
          `Invalid erc721 tokenHash: "${hash}" (expected "erc721/{chainId}/{contractAddress}/{tokenId}")`
        );
      }
      const chainId = Number(parts[1]);
      const contractAddress = parts[2]!;
      const nftTokenId = parts[3]!;
      if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error(`Invalid chainId in tokenHash: "${parts[1]}"`);
      }
      if (!contractAddress.startsWith('0x') || contractAddress.length !== 42) {
        throw new Error(`Invalid contractAddress in tokenHash: "${parts[2]}"`);
      }
      if (!nftTokenId) {
        throw new Error(`Invalid tokenId in tokenHash: empty string`);
      }
      return { tokenType: 'erc721', chainId, contractAddress, tokenId: nftTokenId };
    }

    case 'basic-currency': {
      if (parts.length !== 2) {
        throw new Error(
          `Invalid basic-currency tokenHash: "${hash}" (expected "basic-currency/{currencyCode}")`
        );
      }
      const currencyCode = parts[1]!;
      if (!currencyCode) {
        throw new Error(`Invalid currencyCode in tokenHash: empty string`);
      }
      return { tokenType: 'basic-currency', currencyCode };
    }

    case 'staking-share': {
      if (parts.length !== 3) {
        throw new Error(
          `Invalid staking-share tokenHash: "${hash}" (expected "staking-share/{chainId}/{vaultAddress}")`
        );
      }
      const chainId = Number(parts[1]);
      const vaultAddress = parts[2]!;
      if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error(`Invalid chainId in tokenHash: "${parts[1]}"`);
      }
      if (!vaultAddress.startsWith('0x') || vaultAddress.length !== 42) {
        throw new Error(`Invalid vaultAddress in tokenHash: "${parts[2]}"`);
      }
      return { tokenType: 'staking-share', chainId, vaultAddress };
    }

    default:
      throw new Error(`Unknown token type in tokenHash: "${tokenType}"`);
  }
}
