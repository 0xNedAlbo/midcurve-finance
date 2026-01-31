import type { ComponentState } from './component-state.js';

export interface ComponentStateEntry<TState extends ComponentState = ComponentState> {
  componentId: string;
  state: TState;
}

export interface SimulationState {
  /** Current simulated price */
  currentPrice: bigint;
  /** Starting price (for reset) */
  startingPrice: bigint;
  /** All component states */
  componentStates: ComponentStateEntry[];
}
