/**
 * UniswapV3 Vault Position Configuration
 *
 * Immutable configuration for vault share positions.
 * Contains vault identity, underlying pool parameters, and price range.
 */

// ============================================================================
// DATA INTERFACE
// ============================================================================

export interface UniswapV3VaultPositionConfigData {
  /** Chain ID where the vault is deployed */
  chainId: number;

  /** AllowlistedUniswapV3Vault clone address (EIP-55 checksummed) */
  vaultAddress: string;

  /** NFT token ID wrapped by the vault */
  underlyingTokenId: number;

  /** UniswapV3VaultFactory address (EIP-55 checksummed) */
  factoryAddress: string;

  /** User's wallet address that holds the shares (EIP-55 checksummed) */
  ownerAddress: string;

  /** Uniswap V3 pool address (EIP-55 checksummed) */
  poolAddress: string;

  /** Token0 ERC-20 contract address (EIP-55 checksummed) */
  token0Address: string;

  /** Token1 ERC-20 contract address (EIP-55 checksummed) */
  token1Address: string;

  /** Fee tier in basis points (100, 500, 3000, 10000) */
  feeBps: number;

  /** Tick spacing for this fee tier */
  tickSpacing: number;

  /** Lower tick bound of the underlying position */
  tickLower: number;

  /** Upper tick bound of the underlying position */
  tickUpper: number;

  /** ERC-20 decimals of the vault share token */
  vaultDecimals: number;

  /** Whether token0 is the quote token */
  isToken0Quote: boolean;

  /** Lower price range bound in quote token units (bigint) */
  priceRangeLower: bigint;

  /** Upper price range bound in quote token units (bigint) */
  priceRangeUpper: bigint;
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

export interface UniswapV3VaultPositionConfigJSON {
  chainId: number;
  vaultAddress: string;
  underlyingTokenId: number;
  factoryAddress: string;
  ownerAddress: string;
  poolAddress: string;
  tickLower: number;
  tickUpper: number;
  vaultDecimals: number;
  isToken0Quote: boolean;
  priceRangeLower: string;
  priceRangeUpper: string;
  // Pool-level fields (present in DB JSON, omitted from API responses)
  token0Address?: string;
  token1Address?: string;
  feeBps?: number;
  tickSpacing?: number;
}

// ============================================================================
// CONFIG CLASS
// ============================================================================

export class UniswapV3VaultPositionConfig
  implements UniswapV3VaultPositionConfigData
{
  readonly chainId: number;
  readonly vaultAddress: string;
  readonly underlyingTokenId: number;
  readonly factoryAddress: string;
  readonly ownerAddress: string;
  readonly poolAddress: string;
  readonly token0Address: string;
  readonly token1Address: string;
  readonly feeBps: number;
  readonly tickSpacing: number;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly vaultDecimals: number;
  readonly isToken0Quote: boolean;
  readonly priceRangeLower: bigint;
  readonly priceRangeUpper: bigint;

  constructor(data: UniswapV3VaultPositionConfigData) {
    this.chainId = data.chainId;
    this.vaultAddress = data.vaultAddress;
    this.underlyingTokenId = data.underlyingTokenId;
    this.factoryAddress = data.factoryAddress;
    this.ownerAddress = data.ownerAddress;
    this.poolAddress = data.poolAddress;
    this.token0Address = data.token0Address;
    this.token1Address = data.token1Address;
    this.feeBps = data.feeBps;
    this.tickSpacing = data.tickSpacing;
    this.tickLower = data.tickLower;
    this.tickUpper = data.tickUpper;
    this.vaultDecimals = data.vaultDecimals;
    this.isToken0Quote = data.isToken0Quote;
    this.priceRangeLower = data.priceRangeLower;
    this.priceRangeUpper = data.priceRangeUpper;
  }

  toJSON(): UniswapV3VaultPositionConfigJSON {
    return {
      chainId: this.chainId,
      vaultAddress: this.vaultAddress,
      underlyingTokenId: this.underlyingTokenId,
      factoryAddress: this.factoryAddress,
      ownerAddress: this.ownerAddress,
      poolAddress: this.poolAddress,
      token0Address: this.token0Address,
      token1Address: this.token1Address,
      feeBps: this.feeBps,
      tickSpacing: this.tickSpacing,
      tickLower: this.tickLower,
      tickUpper: this.tickUpper,
      vaultDecimals: this.vaultDecimals,
      isToken0Quote: this.isToken0Quote,
      priceRangeLower: this.priceRangeLower.toString(),
      priceRangeUpper: this.priceRangeUpper.toString(),
    };
  }

  static fromJSON(
    json: UniswapV3VaultPositionConfigJSON
  ): UniswapV3VaultPositionConfig {
    return new UniswapV3VaultPositionConfig({
      ...json,
      token0Address: json.token0Address ?? '',
      token1Address: json.token1Address ?? '',
      feeBps: json.feeBps ?? 0,
      tickSpacing: json.tickSpacing ?? 0,
      priceRangeLower: BigInt(json.priceRangeLower),
      priceRangeUpper: BigInt(json.priceRangeUpper),
    });
  }
}
