import type { ComponentState } from '../types/component-state.js';
import type { Trigger } from '../types/trigger.js';
import type { SimulationResult } from '../types/simulation-result.js';
import type { PriceOracle } from '../oracle/price-oracle.js';

export type ComponentType =
  | 'uniswapv3-position'
  | 'stop-loss'
  | 'take-profit'
  | 'perpetual-hedge';

export interface SimulationComponent<
  TState extends ComponentState = ComponentState,
> {
  /** Unique component identifier */
  readonly id: string;
  /** Component type discriminator */
  readonly type: ComponentType;
  /** Human-readable label */
  readonly label: string;

  /** Create initial state */
  createInitialState(): TState;

  /** Get trigger prices */
  getTriggers(state: TState): Trigger[];

  /** Simulate at given price */
  simulate(
    price: bigint,
    state: TState,
    oracle: PriceOracle,
    priceRange: { min: bigint; max: bigint },
    numPoints: number
  ): SimulationResult<TState>;
}
