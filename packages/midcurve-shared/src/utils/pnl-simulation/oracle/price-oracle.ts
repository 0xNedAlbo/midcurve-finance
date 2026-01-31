import type { Erc20Token } from '../../../types/index.js';

export type Denomination = Erc20Token | 'USD';

export interface PriceOracle {
  /**
   * Get price of a token in terms of another denomination.
   */
  getPrice(token: Denomination, denominationToken: Denomination): bigint;

  /**
   * Convert amount from one denomination to another.
   */
  convert(
    amount: bigint,
    fromToken: Denomination,
    toToken: Denomination
  ): bigint;
}
