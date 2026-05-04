/**
 * UniswapV3 Staking Position Configuration
 *
 * Immutable configuration for UniswapV3StakingVault positions.
 * Each Position row corresponds to a single staking-vault clone (1:1 with owner).
 */

// ============================================================================
// DATA INTERFACE
// ============================================================================

export interface UniswapV3StakingPositionConfigData {
  /** Chain ID where the staking vault is deployed */
  chainId: number;

  /** UniswapV3StakingVault clone address (EIP-55 checksummed) */
  vaultAddress: string;

  /** UniswapV3StakingVaultFactory address (EIP-55 checksummed) */
  factoryAddress: string;

  /** Owner address bound to the vault clone (EIP-55 checksummed) */
  ownerAddress: string;

  /** NFT token id minted by the vault on `stake()` */
  underlyingTokenId: number;

  /** Whether token0 is the quote token (immutable; encoded on-chain at stake) */
  isToken0Quote: boolean;

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

  /** Lower price range bound in quote token units (bigint) */
  priceRangeLower: bigint;

  /** Upper price range bound in quote token units (bigint) */
  priceRangeUpper: bigint;
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

export interface UniswapV3StakingPositionConfigJSON {
  chainId: number;
  vaultAddress: string;
  factoryAddress: string;
  ownerAddress: string;
  underlyingTokenId: number;
  isToken0Quote: boolean;
  poolAddress: string;
  tickLower: number;
  tickUpper: number;
  priceRangeLower: string;
  priceRangeUpper: string;
  // Pool-level fields (present in DB JSON, optional in API responses)
  token0Address?: string;
  token1Address?: string;
  feeBps?: number;
  tickSpacing?: number;
}

// ============================================================================
// CONFIG CLASS
// ============================================================================

export class UniswapV3StakingPositionConfig
  implements UniswapV3StakingPositionConfigData
{
  readonly chainId: number;
  readonly vaultAddress: string;
  readonly factoryAddress: string;
  readonly ownerAddress: string;
  readonly underlyingTokenId: number;
  readonly isToken0Quote: boolean;
  readonly poolAddress: string;
  readonly token0Address: string;
  readonly token1Address: string;
  readonly feeBps: number;
  readonly tickSpacing: number;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly priceRangeLower: bigint;
  readonly priceRangeUpper: bigint;

  constructor(data: UniswapV3StakingPositionConfigData) {
    this.chainId = data.chainId;
    this.vaultAddress = data.vaultAddress;
    this.factoryAddress = data.factoryAddress;
    this.ownerAddress = data.ownerAddress;
    this.underlyingTokenId = data.underlyingTokenId;
    this.isToken0Quote = data.isToken0Quote;
    this.poolAddress = data.poolAddress;
    this.token0Address = data.token0Address;
    this.token1Address = data.token1Address;
    this.feeBps = data.feeBps;
    this.tickSpacing = data.tickSpacing;
    this.tickLower = data.tickLower;
    this.tickUpper = data.tickUpper;
    this.priceRangeLower = data.priceRangeLower;
    this.priceRangeUpper = data.priceRangeUpper;
  }

  toJSON(): UniswapV3StakingPositionConfigJSON {
    return {
      chainId: this.chainId,
      vaultAddress: this.vaultAddress,
      factoryAddress: this.factoryAddress,
      ownerAddress: this.ownerAddress,
      underlyingTokenId: this.underlyingTokenId,
      isToken0Quote: this.isToken0Quote,
      poolAddress: this.poolAddress,
      token0Address: this.token0Address,
      token1Address: this.token1Address,
      feeBps: this.feeBps,
      tickSpacing: this.tickSpacing,
      tickLower: this.tickLower,
      tickUpper: this.tickUpper,
      priceRangeLower: this.priceRangeLower.toString(),
      priceRangeUpper: this.priceRangeUpper.toString(),
    };
  }

  static fromJSON(
    json: UniswapV3StakingPositionConfigJSON,
  ): UniswapV3StakingPositionConfig {
    return new UniswapV3StakingPositionConfig({
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
