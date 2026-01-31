import type { ComponentState } from './component-state.js';

export interface CurvePoint {
  price: bigint;
  pnl: bigint;
}

export interface SimulationResult<TState extends ComponentState> {
  /** Current PnL in quote token units */
  pnl: bigint;
  /** PnL at each price point in range */
  curvePoints: CurvePoint[];
  /** Updated component state */
  newState: TState;
  /** Original denomination if not quote token */
  denomination?: string;
}
