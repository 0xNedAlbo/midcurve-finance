import type { UniswapV3Position, UniswapV3Pool } from '../../../types/index.js';
import type { ComponentState } from '../types/component-state.js';
import type { Trigger } from '../types/trigger.js';
import type { SimulationResult, CurvePoint } from '../types/simulation-result.js';
import type { PriceOracle } from '../oracle/price-oracle.js';
import type { SimulationComponent } from './simulation-component.js';
import {
  generatePnLCurve,
  calculatePositionValueAtPrice,
} from '../../uniswapv3/position.js';

/**
 * Position has no triggers - stateless calculation.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UniswapV3PositionSimState extends ComponentState {
  // Empty - pure calculation, no state
}

/**
 * Simulation component for a Uniswap V3 concentrated liquidity position.
 * This component has no triggers - it just calculates PnL based on price.
 */
export class UniswapV3PositionComponent
  implements SimulationComponent<UniswapV3PositionSimState>
{
  readonly type = 'uniswapv3-position' as const;
  readonly id: string;
  readonly label: string;

  constructor(
    private readonly position: UniswapV3Position,
    private readonly pool: UniswapV3Pool
  ) {
    this.id = `position-${position.id}`;
    this.label = `${pool.token0.symbol}/${pool.token1.symbol} Position`;
  }

  createInitialState(): UniswapV3PositionSimState {
    return {};
  }

  getTriggers(_state: UniswapV3PositionSimState): Trigger[] {
    return []; // No triggers for base position
  }

  simulate(
    price: bigint,
    state: UniswapV3PositionSimState,
    _oracle: PriceOracle,
    priceRange: { min: bigint; max: bigint },
    numPoints: number
  ): SimulationResult<UniswapV3PositionSimState> {
    const baseToken = this.position.getBaseToken();
    const quoteToken = this.position.getQuoteToken();
    const config = this.position.typedConfig;

    // Calculate PnL at current price
    const currentValue = calculatePositionValueAtPrice(
      this.position.typedState.liquidity,
      config.tickLower,
      config.tickUpper,
      price,
      baseToken.typedConfig.address,
      quoteToken.typedConfig.address,
      baseToken.decimals,
      this.pool.tickSpacing
    );
    const pnl = currentValue - this.position.currentCostBasis;

    // Generate full curve
    const curvePoints: CurvePoint[] = generatePnLCurve(
      this.position.typedState.liquidity,
      config.tickLower,
      config.tickUpper,
      this.position.currentCostBasis,
      baseToken.typedConfig.address,
      quoteToken.typedConfig.address,
      baseToken.decimals,
      this.pool.tickSpacing,
      priceRange,
      numPoints
    ).map((p) => ({ price: p.price, pnl: p.pnl }));

    return { pnl, curvePoints, newState: state };
  }

  /**
   * Helper: calculate PnL at a specific price.
   * Used by SL/TP components to determine locked PnL at trigger.
   */
  calculatePnLAt(price: bigint): bigint {
    const baseToken = this.position.getBaseToken();
    const quoteToken = this.position.getQuoteToken();
    const config = this.position.typedConfig;

    const value = calculatePositionValueAtPrice(
      this.position.typedState.liquidity,
      config.tickLower,
      config.tickUpper,
      price,
      baseToken.typedConfig.address,
      quoteToken.typedConfig.address,
      baseToken.decimals,
      this.pool.tickSpacing
    );
    return value - this.position.currentCostBasis;
  }

  /**
   * Helper: calculate position value at a specific price.
   * Used by SL/TP components.
   */
  calculateValueAt(price: bigint): bigint {
    const baseToken = this.position.getBaseToken();
    const quoteToken = this.position.getQuoteToken();
    const config = this.position.typedConfig;

    return calculatePositionValueAtPrice(
      this.position.typedState.liquidity,
      config.tickLower,
      config.tickUpper,
      price,
      baseToken.typedConfig.address,
      quoteToken.typedConfig.address,
      baseToken.decimals,
      this.pool.tickSpacing
    );
  }
}
