/**
 * UniswapV3 Vault Position
 *
 * Concrete position implementation for vault share positions.
 * Extends BasePosition with vault-specific configuration and state.
 */

import { BasePosition } from '../base-position.js';
import { UniswapV3Pool } from '../../pool/index.js';
import { UniswapV3PoolConfig } from '../../pool/uniswapv3/uniswapv3-pool-config.js';
import type { PoolInterface } from '../../pool/index.js';
import type { Erc20Token, TokenInterface } from '../../token/index.js';
import type {
  PositionProtocol,
  BasePositionParams,
  PositionRow,
  PnLSimulationResult,
  PositionJSON,
} from '../position.types.js';
import {
  UniswapV3VaultPositionConfig,
  type UniswapV3VaultPositionConfigJSON,
} from './uniswapv3-vault-position-config.js';
import {
  type UniswapV3VaultPositionState,
  type UniswapV3VaultPositionStateJSON,
  vaultPositionStateToJSON,
  vaultPositionStateFromJSON,
} from './uniswapv3-vault-position-state.js';
import { calculatePositionValue } from '../../../utils/uniswapv3/liquidity.js';
import { priceToSqrtRatioX96 } from '../../../utils/uniswapv3/price.js';

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

export interface UniswapV3VaultPositionParams extends BasePositionParams {
  config: UniswapV3VaultPositionConfig;
  state: UniswapV3VaultPositionState;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

export interface UniswapV3VaultPositionRow extends PositionRow {
  protocol: 'uniswapv3-vault';
}

// ============================================================================
// POSITION CLASS
// ============================================================================

export class UniswapV3VaultPosition extends BasePosition {
  readonly protocol: PositionProtocol = 'uniswapv3-vault';

  private readonly _config: UniswapV3VaultPositionConfig;
  private readonly _state: UniswapV3VaultPositionState;

  constructor(params: UniswapV3VaultPositionParams) {
    super(params);
    this._config = params.config;
    this._state = params.state;
  }

  // ============================================================================
  // Computed Pool (same underlying pool as the NFT)
  // ============================================================================

  get pool(): PoolInterface {
    return new UniswapV3Pool({
      id: `uniswapv3/${this._config.chainId}/${this._config.poolAddress}`,
      token0: this.token0,
      token1: this.token1,
      config: new UniswapV3PoolConfig({
        chainId: this._config.chainId,
        address: this._config.poolAddress,
        token0: this._config.token0Address,
        token1: this._config.token1Address,
        feeBps: this._config.feeBps,
        tickSpacing: this._config.tickSpacing,
      }),
      state: {
        sqrtPriceX96: this._state.sqrtPriceX96,
        currentTick: this._state.currentTick,
        liquidity: this._state.poolLiquidity,
        feeGrowthGlobal0: this._state.feeGrowthGlobal0,
        feeGrowthGlobal1: this._state.feeGrowthGlobal1,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }

  // ============================================================================
  // Config/State Accessors (PositionInterface compliance)
  // ============================================================================

  get config(): Record<string, unknown> {
    return this._config.toJSON() as unknown as Record<string, unknown>;
  }

  get state(): Record<string, unknown> {
    return vaultPositionStateToJSON(this._state) as unknown as Record<string, unknown>;
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  get typedConfig(): UniswapV3VaultPositionConfig {
    return this._config;
  }

  get typedState(): UniswapV3VaultPositionState {
    return this._state;
  }

  // ============================================================================
  // Convenience Accessors - Config
  // ============================================================================

  get chainId(): number {
    return this._config.chainId;
  }

  get vaultAddress(): string {
    return this._config.vaultAddress;
  }

  get underlyingTokenId(): number {
    return this._config.underlyingTokenId;
  }

  get poolAddress(): string {
    return this._config.poolAddress;
  }

  get tickLower(): number {
    return this._config.tickLower;
  }

  get tickUpper(): number {
    return this._config.tickUpper;
  }

  get vaultDecimals(): number {
    return this._config.vaultDecimals;
  }

  // ============================================================================
  // Convenience Accessors - State
  // ============================================================================

  get sharesBalance(): bigint {
    return this._state.sharesBalance;
  }

  get totalSupply(): bigint {
    return this._state.totalSupply;
  }

  /** Vault's total liquidity in the underlying NFT */
  get liquidity(): bigint {
    return this._state.liquidity;
  }

  /** User's proportional liquidity: liquidity * sharesBalance / totalSupply */
  get userLiquidity(): bigint {
    if (this._state.totalSupply === 0n) return 0n;
    return (this._state.liquidity * this._state.sharesBalance) / this._state.totalSupply;
  }

  get unclaimedFees0(): bigint {
    return this._state.unclaimedFees0;
  }

  get unclaimedFees1(): bigint {
    return this._state.unclaimedFees1;
  }

  // ============================================================================
  // Position Properties (from config)
  // ============================================================================

  get isToken0Quote(): boolean {
    return this._config.isToken0Quote;
  }

  get priceRangeLower(): bigint {
    return this._config.priceRangeLower;
  }

  get priceRangeUpper(): bigint {
    return this._config.priceRangeUpper;
  }

  getBaseToken(): TokenInterface {
    return this.isToken0Quote ? this.token1 : this.token0;
  }

  getQuoteToken(): TokenInterface {
    return this.isToken0Quote ? this.token0 : this.token1;
  }

  // ============================================================================
  // Serialization
  // ============================================================================

  override toJSON(): PositionJSON {
    return {
      ...super.toJSON(),
      isToken0Quote: this.isToken0Quote,
      priceRangeLower: this.priceRangeLower.toString(),
      priceRangeUpper: this.priceRangeUpper.toString(),
    };
  }

  // ============================================================================
  // PnL Simulation
  // ============================================================================

  simulatePnLAtPrice(price: bigint): PnLSimulationResult {
    const baseIsToken0 = !this.isToken0Quote;

    // Calculate the user's proportional position value at the given price
    const baseToken = this.getBaseToken() as Erc20Token;
    const quoteToken = this.getQuoteToken() as Erc20Token;
    const sqrtPriceJSBI = priceToSqrtRatioX96(
      baseToken.address,
      quoteToken.address,
      baseToken.decimals,
      price
    );
    const sqrtPriceX96 = BigInt(sqrtPriceJSBI.toString());

    // Full vault position value, then take user's proportional share
    const fullValue = calculatePositionValue(
      this.liquidity,
      sqrtPriceX96,
      this.tickLower,
      this.tickUpper,
      baseIsToken0
    );
    const positionValue = this._state.totalSupply > 0n
      ? (fullValue * this._state.sharesBalance) / this._state.totalSupply
      : 0n;

    const pnlValue = positionValue - this.costBasis;
    const pnlPercent = this.costBasis > 0n
      ? Number((pnlValue * 1000000n) / this.costBasis) / 10000
      : 0;

    return { positionValue, pnlValue, pnlPercent };
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  static fromDB(
    row: UniswapV3VaultPositionRow,
    token0: TokenInterface,
    token1: TokenInterface
  ): UniswapV3VaultPosition {
    const configJSON = row.config as unknown as UniswapV3VaultPositionConfigJSON;
    const stateJSON = row.state as unknown as UniswapV3VaultPositionStateJSON;

    return new UniswapV3VaultPosition({
      id: row.id,
      positionHash: row.positionHash,
      userId: row.userId,
      type: row.type,
      token0,
      token1,
      currentValue: row.currentValue,
      costBasis: row.costBasis,
      realizedPnl: row.realizedPnl,
      unrealizedPnl: row.unrealizedPnl,
      realizedCashflow: row.realizedCashflow,
      unrealizedCashflow: row.unrealizedCashflow,
      collectedYield: row.collectedYield,
      unclaimedYield: row.unclaimedYield,
      lastYieldClaimedAt: row.lastYieldClaimedAt,
      baseApr: row.baseApr,
      rewardApr: row.rewardApr,
      totalApr: row.totalApr,
      positionOpenedAt: row.positionOpenedAt,
      archivedAt: row.archivedAt,
      isArchived: row.isArchived,
      config: UniswapV3VaultPositionConfig.fromJSON(configJSON),
      state: vaultPositionStateFromJSON(stateJSON),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static fromJSON(
    json: PositionJSON,
    token0: TokenInterface,
    token1: TokenInterface
  ): UniswapV3VaultPosition {
    const configJSON = json.config as unknown as UniswapV3VaultPositionConfigJSON;
    const stateJSON = json.state as unknown as UniswapV3VaultPositionStateJSON;

    return new UniswapV3VaultPosition({
      id: json.id,
      positionHash: json.positionHash ?? null,
      userId: json.userId,
      type: json.type,
      token0,
      token1,
      currentValue: BigInt(json.currentValue),
      costBasis: BigInt(json.costBasis),
      realizedPnl: BigInt(json.realizedPnl),
      unrealizedPnl: BigInt(json.unrealizedPnl),
      realizedCashflow: BigInt(json.realizedCashflow),
      unrealizedCashflow: BigInt(json.unrealizedCashflow),
      collectedYield: BigInt(json.collectedYield),
      unclaimedYield: BigInt(json.unclaimedYield),
      lastYieldClaimedAt: new Date(json.lastYieldClaimedAt),
      baseApr: json.baseApr,
      rewardApr: json.rewardApr,
      totalApr: json.totalApr,
      positionOpenedAt: new Date(json.positionOpenedAt),
      archivedAt: json.archivedAt
        ? new Date(json.archivedAt)
        : null,
      isArchived: json.isArchived,
      config: UniswapV3VaultPositionConfig.fromJSON(configJSON),
      state: vaultPositionStateFromJSON(stateJSON),
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
    });
  }
}
