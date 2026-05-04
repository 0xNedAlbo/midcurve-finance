/**
 * UniswapV3 Staking Position
 *
 * Concrete position implementation for UniswapV3StakingVault clones.
 * Each vault is owner-bound (1:1) and wraps a single Uniswap V3 NFT position
 * with a quote-side yield target.
 *
 * Key differences from UniswapV3VaultPosition:
 * - No share token model — `liquidity` is the user's whole position liquidity
 * - `isClosed()` is derived from `vaultState === 'Settled'`
 * - Yield is realized at swap (Model A) — never collected separately as fees
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
  UniswapV3StakingPositionConfig,
  type UniswapV3StakingPositionConfigJSON,
} from './uniswapv3-staking-position-config.js';
import {
  type UniswapV3StakingPositionState,
  type UniswapV3StakingPositionStateJSON,
  stakingPositionStateToJSON,
  stakingPositionStateFromJSON,
} from './uniswapv3-staking-position-state.js';
import { calculatePositionValue } from '../../../utils/uniswapv3/liquidity.js';
import { priceToSqrtRatioX96 } from '../../../utils/uniswapv3/price.js';

// ============================================================================
// CONSTRUCTOR PARAMS
// ============================================================================

export interface UniswapV3StakingPositionParams extends BasePositionParams {
  config: UniswapV3StakingPositionConfig;
  state: UniswapV3StakingPositionState;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

export interface UniswapV3StakingPositionRow extends PositionRow {
  protocol: 'uniswapv3-staking';
}

// ============================================================================
// POSITION CLASS
// ============================================================================

export class UniswapV3StakingPosition extends BasePosition {
  readonly protocol: PositionProtocol = 'uniswapv3-staking';

  private readonly _config: UniswapV3StakingPositionConfig;
  private readonly _state: UniswapV3StakingPositionState;

  constructor(params: UniswapV3StakingPositionParams) {
    super(params);
    this._config = params.config;
    this._state = params.state;
  }

  // ============================================================================
  // Hash builder
  // ============================================================================

  /**
   * Canonical positionHash for staking vaults.
   * Vault clones are owner-bound 1:1, so vaultAddress alone disambiguates.
   */
  static createHash(chainId: number, vaultAddress: string): string {
    return `uniswapv3-staking/${chainId}/${vaultAddress}`;
  }

  // ============================================================================
  // Computed Pool (same underlying pool as the wrapped NFT)
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
    return stakingPositionStateToJSON(this._state) as unknown as Record<
      string,
      unknown
    >;
  }

  // ============================================================================
  // Typed Accessors
  // ============================================================================

  get typedConfig(): UniswapV3StakingPositionConfig {
    return this._config;
  }

  get typedState(): UniswapV3StakingPositionState {
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

  get factoryAddress(): string {
    return this._config.factoryAddress;
  }

  get ownerAddress(): string {
    return this._config.ownerAddress;
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

  // ============================================================================
  // Convenience Accessors - State
  // ============================================================================

  get vaultState(): UniswapV3StakingPositionState['vaultState'] {
    return this._state.vaultState;
  }

  get liquidity(): bigint {
    return this._state.liquidity;
  }

  get stakedBase(): bigint {
    return this._state.stakedBase;
  }

  get stakedQuote(): bigint {
    return this._state.stakedQuote;
  }

  get yieldTarget(): bigint {
    return this._state.yieldTarget;
  }

  get pendingBps(): number {
    return this._state.pendingBps;
  }

  get unclaimedYieldBase(): bigint {
    return this._state.unclaimedYieldBase;
  }

  get unclaimedYieldQuote(): bigint {
    return this._state.unclaimedYieldQuote;
  }

  /** Lifecycle helper — Settled means no further interactions are possible. */
  isClosed(): boolean {
    return this._state.vaultState === 'Settled';
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

    const baseToken = this.getBaseToken() as Erc20Token;
    const quoteToken = this.getQuoteToken() as Erc20Token;
    const sqrtPriceJSBI = priceToSqrtRatioX96(
      baseToken.address,
      quoteToken.address,
      baseToken.decimals,
      price,
    );
    const sqrtPriceX96 = BigInt(sqrtPriceJSBI.toString());

    const positionValue = calculatePositionValue(
      this.liquidity,
      sqrtPriceX96,
      this.tickLower,
      this.tickUpper,
      baseIsToken0,
    );

    const pnlValue = positionValue - this.costBasis;
    const pnlPercent =
      this.costBasis > 0n
        ? Number((pnlValue * 1000000n) / this.costBasis) / 10000
        : 0;

    return { positionValue, pnlValue, pnlPercent };
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  static fromDB(
    row: UniswapV3StakingPositionRow,
    token0: TokenInterface,
    token1: TokenInterface,
  ): UniswapV3StakingPosition {
    const configJSON = row.config as unknown as UniswapV3StakingPositionConfigJSON;
    const stateJSON = row.state as unknown as UniswapV3StakingPositionStateJSON;

    return new UniswapV3StakingPosition({
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
      config: UniswapV3StakingPositionConfig.fromJSON(configJSON),
      state: stakingPositionStateFromJSON(stateJSON),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static fromJSON(
    json: PositionJSON,
    token0: TokenInterface,
    token1: TokenInterface,
  ): UniswapV3StakingPosition {
    const configJSON = json.config as unknown as UniswapV3StakingPositionConfigJSON;
    const stateJSON = json.state as unknown as UniswapV3StakingPositionStateJSON;

    return new UniswapV3StakingPosition({
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
      archivedAt: json.archivedAt ? new Date(json.archivedAt) : null,
      isArchived: json.isArchived,
      config: UniswapV3StakingPositionConfig.fromJSON(configJSON),
      state: stakingPositionStateFromJSON(stateJSON),
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
    });
  }
}
