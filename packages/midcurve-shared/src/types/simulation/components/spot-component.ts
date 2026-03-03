/**
 * SpotComponent
 *
 * Holds fixed token amounts (post-trigger state). Value is a linear function
 * of price based on the base token amount plus a constant quote token amount.
 *
 * Covers all three post-trigger exposure types:
 * - ALL_QUOTE: baseAmount=0n → flat horizontal line
 * - ALL_BASE:  quoteAmount=0n → linear (proportional to price)
 * - HOLD_MIXED: both non-zero → linear with offset
 */

import type { SimulationComponent } from '../simulation-component.js';

export class SpotComponent implements SimulationComponent {
  readonly type = 'spot' as const;

  constructor(
    readonly id: string,
    private readonly baseAmount: bigint,
    private readonly quoteAmount: bigint,
    private readonly baseDecimals: number,
  ) {}

  getValueAtPrice(price: bigint): bigint {
    const baseDivisor = 10n ** BigInt(this.baseDecimals);
    return (this.baseAmount * price) / baseDivisor + this.quoteAmount;
  }

  getBaseAmountAtPrice(_price: bigint): bigint {
    return this.baseAmount;
  }

  getQuoteAmountAtPrice(_price: bigint): bigint {
    return this.quoteAmount;
  }
}
