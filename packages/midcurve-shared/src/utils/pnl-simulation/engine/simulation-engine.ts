import type { SimulationComponent } from '../components/simulation-component.js';
import type { ComponentState } from '../types/component-state.js';
import type { SimulationState } from '../types/simulation-state.js';
import type { SimulationConfig } from '../types/simulation-config.js';
import type { CurvePoint } from '../types/simulation-result.js';
import type { Trigger } from '../types/trigger.js';
import type { PriceOracle } from '../oracle/price-oracle.js';

export interface EngineSimulationResult {
  /** Total PnL (sum of all components) */
  totalPnl: bigint;
  /** Aggregated curve points */
  curvePoints: CurvePoint[];
  /** Updated simulation state */
  newState: SimulationState;
  /** Components that triggered at this price */
  triggeredComponents: string[];
}

/**
 * SimulationEngine orchestrates multiple simulation components.
 * It maintains state across all components and aggregates their PnL curves.
 */
export class SimulationEngine {
  private readonly components: SimulationComponent[];
  private readonly oracle: PriceOracle;
  private readonly config: SimulationConfig;

  constructor(params: {
    components: SimulationComponent[];
    oracle: PriceOracle;
    config: SimulationConfig;
  }) {
    this.components = params.components;
    this.oracle = params.oracle;
    this.config = params.config;
  }

  /**
   * Create initial state for all components.
   */
  createInitialState(): SimulationState {
    return {
      currentPrice: this.config.startingPrice,
      startingPrice: this.config.startingPrice,
      componentStates: this.components.map((c) => ({
        componentId: c.id,
        state: c.createInitialState(),
      })),
    };
  }

  /**
   * Simulate at a given price.
   * Checks for trigger crossings and updates state.
   */
  simulate(price: bigint, state: SimulationState): EngineSimulationResult {
    const triggeredComponents: string[] = [];
    const componentResults: Array<{
      componentId: string;
      pnl: bigint;
      curvePoints: CurvePoint[];
      newState: ComponentState;
    }> = [];

    // Simulate each component
    for (let i = 0; i < this.components.length; i++) {
      const component = this.components[i];
      const componentStateEntry = state.componentStates[i];
      if (!component || !componentStateEntry) {
        continue;
      }
      const currentState = componentStateEntry.state;

      // Check if any triggers cross between previous and current price
      const triggers = component.getTriggers(currentState);

      for (const trigger of triggers) {
        if (this.didCrossTrigger(state.currentPrice, price, trigger)) {
          triggeredComponents.push(component.id);
          break;
        }
      }

      // Simulate component
      const result = component.simulate(
        price,
        currentState,
        this.oracle,
        this.config.priceRange,
        this.config.numPoints
      );

      componentResults.push({
        componentId: component.id,
        pnl: result.pnl,
        curvePoints: result.curvePoints,
        newState: result.newState,
      });
    }

    // Aggregate results
    const totalPnl = componentResults.reduce((sum, r) => sum + r.pnl, 0n);
    const curvePoints = this.aggregateCurves(
      componentResults.map((r) => r.curvePoints)
    );

    // Build new state
    const newState: SimulationState = {
      currentPrice: price,
      startingPrice: state.startingPrice,
      componentStates: componentResults.map((r) => ({
        componentId: r.componentId,
        state: r.newState,
      })),
    };

    return { totalPnl, curvePoints, newState, triggeredComponents };
  }

  /**
   * Check if price movement crossed a trigger.
   */
  private didCrossTrigger(
    fromPrice: bigint,
    toPrice: bigint,
    trigger: Trigger
  ): boolean {
    if (trigger.direction === 'below') {
      // Trigger when price crosses below
      return fromPrice > trigger.price && toPrice <= trigger.price;
    } else {
      // Trigger when price crosses above
      return fromPrice < trigger.price && toPrice >= trigger.price;
    }
  }

  /**
   * Aggregate curve points from all components.
   * Sums PnL at each price point.
   */
  private aggregateCurves(curves: CurvePoint[][]): CurvePoint[] {
    if (curves.length === 0) return [];
    const firstCurve = curves[0];
    if (!firstCurve) return [];
    if (curves.length === 1) return firstCurve;

    // Assume all curves have same price points
    const result: CurvePoint[] = [];
    const numPoints = firstCurve.length;

    for (let i = 0; i < numPoints; i++) {
      const firstPoint = firstCurve[i];
      if (!firstPoint) continue;
      const price = firstPoint.price;
      const totalPnl = curves.reduce((sum, curve) => {
        const point = curve[i];
        return sum + (point?.pnl ?? 0n);
      }, 0n);
      result.push({ price, pnl: totalPnl });
    }

    return result;
  }

  /**
   * Get the configuration for this engine.
   */
  getConfig(): SimulationConfig {
    return this.config;
  }

  /**
   * Get the components in this engine.
   */
  getComponents(): readonly SimulationComponent[] {
    return this.components;
  }
}
