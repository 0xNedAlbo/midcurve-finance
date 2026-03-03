/**
 * ClosePositionInstrument
 *
 * Simulates a full position close (stop-loss or take-profit).
 * When triggered, evaluates the target component at the trigger price,
 * builds a SpotComponent replacement based on PostTriggerExposure,
 * and removes ALL instruments targeting the same component.
 */

import type { PostTriggerExposure } from '../../position/close-order-simulation/close-order-simulation-overlay.js';
import type { SimulationInstrument, TriggerDirection } from '../simulation-instrument.js';
import type { SimulationState } from '../simulation-state.js';
import { SpotComponent } from '../components/spot-component.js';

export class ClosePositionInstrument implements SimulationInstrument {
  constructor(
    readonly id: string,
    readonly targetComponentId: string,
    readonly triggerPrice: bigint,
    readonly triggerDirection: TriggerDirection,
    private readonly postTriggerExposure: PostTriggerExposure,
    private readonly baseDecimals: number,
  ) {}

  apply(state: SimulationState, triggerPrice: bigint): SimulationState {
    const target = state.components.find(c => c.id === this.targetComponentId);
    if (!target) {
      return state;
    }

    const baseAmount = target.getBaseAmountAtPrice(triggerPrice);
    const quoteAmount = target.getQuoteAmountAtPrice(triggerPrice);
    const totalValue = target.getValueAtPrice(triggerPrice);

    let replacement: SpotComponent;

    switch (this.postTriggerExposure) {
      case 'ALL_QUOTE':
        replacement = new SpotComponent(target.id, 0n, totalValue, this.baseDecimals);
        break;
      case 'ALL_BASE': {
        const baseDivisor = 10n ** BigInt(this.baseDecimals);
        const totalBase = triggerPrice > 0n
          ? (totalValue * baseDivisor) / triggerPrice
          : 0n;
        replacement = new SpotComponent(target.id, totalBase, 0n, this.baseDecimals);
        break;
      }
      case 'HOLD_MIXED':
        replacement = new SpotComponent(target.id, baseAmount, quoteAmount, this.baseDecimals);
        break;
    }

    return {
      ...state,
      components: state.components.map(c =>
        c.id === this.targetComponentId ? replacement : c,
      ),
      activeInstruments: state.activeInstruments.filter(
        i => i.targetComponentId !== this.targetComponentId,
      ),
    };
  }
}
