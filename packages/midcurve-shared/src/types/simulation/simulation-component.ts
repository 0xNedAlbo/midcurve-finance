/**
 * SimulationComponent Interface
 *
 * An object that holds value at a given price. Each component in a simulation
 * contributes to the total portfolio value.
 *
 * Implementations:
 * - UniswapV3LPComponent: wraps an existing UniswapV3Position
 * - SpotComponent: fixed token amounts (post-trigger state)
 */

export interface SimulationComponent {
  /** Unique identifier for this component */
  readonly id: string;
  /** Discriminator: 'uniswapv3_lp' | 'spot' */
  readonly type: string;
  /** Total value of this component at a given price (quote token units) */
  getValueAtPrice(price: bigint): bigint;
  /** Base token amount at a given price (smallest units) */
  getBaseAmountAtPrice(price: bigint): bigint;
  /** Quote token amount at a given price (smallest units) */
  getQuoteAmountAtPrice(price: bigint): bigint;
}
