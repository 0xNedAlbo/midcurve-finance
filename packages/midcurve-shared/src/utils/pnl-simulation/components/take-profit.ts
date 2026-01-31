import type { ComponentState } from '../types/component-state.js';
import type { Trigger } from '../types/trigger.js';
import type { SimulationResult, CurvePoint } from '../types/simulation-result.js';
import type { PriceOracle } from '../oracle/price-oracle.js';
import type { SimulationComponent } from './simulation-component.js';
import type { UniswapV3PositionComponent } from './uniswapv3-position.js';

export interface TakeProfitState extends ComponentState {
  triggered: boolean;
  lockedPnl?: bigint;
  triggeredAtPrice?: bigint;
}

/**
 * Simulation component for a Take-Profit order.
 * When price crosses above the trigger price, PnL is locked.
 */
export class TakeProfitComponent
  implements SimulationComponent<TakeProfitState>
{
  readonly type = 'take-profit' as const;
  readonly id: string;
  readonly label = 'Take-Profit';

  constructor(
    private readonly triggerPrice: bigint,
    private readonly positionComponent: UniswapV3PositionComponent,
    id?: string
  ) {
    this.id = id ?? `tp-${triggerPrice.toString()}`;
  }

  createInitialState(): TakeProfitState {
    return { triggered: false };
  }

  getTriggers(state: TakeProfitState): Trigger[] {
    if (state.triggered) return [];
    return [
      {
        id: `${this.id}:trigger`,
        price: this.triggerPrice,
        direction: 'above',
        oneShot: true,
      },
    ];
  }

  simulate(
    price: bigint,
    state: TakeProfitState,
    oracle: PriceOracle,
    priceRange: { min: bigint; max: bigint },
    numPoints: number
  ): SimulationResult<TakeProfitState> {
    // Already triggered - return flat curve
    if (state.triggered) {
      const lockedPnl = state.lockedPnl!;
      const flatCurve = this.generateFlatCurve(lockedPnl, priceRange, numPoints);
      return { pnl: lockedPnl, curvePoints: flatCurve, newState: state };
    }

    // Check if trigger fires
    if (price >= this.triggerPrice) {
      const pnlAtTrigger = this.positionComponent.calculatePnLAt(
        this.triggerPrice
      );
      const flatCurve = this.generateFlatCurve(
        pnlAtTrigger,
        priceRange,
        numPoints
      );
      return {
        pnl: pnlAtTrigger,
        curvePoints: flatCurve,
        newState: {
          triggered: true,
          lockedPnl: pnlAtTrigger,
          triggeredAtPrice: this.triggerPrice,
        },
      };
    }

    // Not triggered - delegate to position for PnL/curve, keep our state
    const positionResult = this.positionComponent.simulate(
      price,
      {},
      oracle,
      priceRange,
      numPoints
    );
    return {
      pnl: positionResult.pnl,
      curvePoints: positionResult.curvePoints,
      newState: state, // Keep TakeProfitState unchanged
    };
  }

  private generateFlatCurve(
    pnl: bigint,
    priceRange: { min: bigint; max: bigint },
    numPoints: number
  ): CurvePoint[] {
    const step = (priceRange.max - priceRange.min) / BigInt(numPoints - 1);
    const points: CurvePoint[] = [];
    for (let i = 0; i < numPoints; i++) {
      const price = priceRange.min + step * BigInt(i);
      points.push({ price, pnl });
    }
    return points;
  }
}
