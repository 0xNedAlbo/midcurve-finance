/**
 * UniswapV3LPComponent
 *
 * Wraps an existing UniswapV3Position and delegates all valuation
 * to its simulatePnLAtPrice() method.
 */

import type { UniswapV3Position } from '../../position/uniswapv3/uniswapv3-position.js';
import type { SimulationComponent } from '../simulation-component.js';

export class UniswapV3LPComponent implements SimulationComponent {
  readonly type = 'uniswapv3_lp' as const;

  constructor(
    readonly id: string,
    private readonly position: UniswapV3Position,
  ) {}

  getValueAtPrice(price: bigint): bigint {
    return this.position.simulatePnLAtPrice(price).positionValue;
  }

  getBaseAmountAtPrice(price: bigint): bigint {
    return this.position.simulatePnLAtPrice(price).baseTokenAmount;
  }

  getQuoteAmountAtPrice(price: bigint): bigint {
    return this.position.simulatePnLAtPrice(price).quoteTokenAmount;
  }
}
