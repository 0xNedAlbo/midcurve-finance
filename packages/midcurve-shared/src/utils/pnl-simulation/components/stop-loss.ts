import type { ComponentState } from '../types/component-state.js';
import type { Trigger } from '../types/trigger.js';
import type { SimulationResult, CurvePoint } from '../types/simulation-result.js';
import type { PriceOracle } from '../oracle/price-oracle.js';
import type { SimulationComponent } from './simulation-component.js';
import type { UniswapV3PositionComponent } from './uniswapv3-position.js';

export interface StopLossState extends ComponentState {
  triggered: boolean;
  lockedPnl?: bigint;
  triggeredAtPrice?: bigint;
}

/**
 * Simulation component for a Stop-Loss order.
 * When price crosses below the trigger price, PnL is locked.
 */
export class StopLossComponent implements SimulationComponent<StopLossState> {
  readonly type = 'stop-loss' as const;
  readonly id: string;
  readonly label = 'Stop-Loss';

  constructor(
    private readonly triggerPrice: bigint,
    private readonly positionComponent: UniswapV3PositionComponent,
    id?: string
  ) {
    this.id = id ?? `sl-${triggerPrice.toString()}`;
  }

  createInitialState(): StopLossState {
    return { triggered: false };
  }

  getTriggers(state: StopLossState): Trigger[] {
    if (state.triggered) return [];
    return [
      {
        id: `${this.id}:trigger`,
        price: this.triggerPrice,
        direction: 'below',
        oneShot: true,
      },
    ];
  }

  simulate(
    price: bigint,
    state: StopLossState,
    oracle: PriceOracle,
    priceRange: { min: bigint; max: bigint },
    numPoints: number
  ): SimulationResult<StopLossState> {
    // Already triggered - return flat curve
    if (state.triggered) {
      const lockedPnl = state.lockedPnl!;
      const flatCurve = this.generateFlatCurve(lockedPnl, priceRange, numPoints);
      return { pnl: lockedPnl, curvePoints: flatCurve, newState: state };
    }

    // Check if trigger fires
    if (price <= this.triggerPrice) {
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
      newState: state, // Keep StopLossState unchanged
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
