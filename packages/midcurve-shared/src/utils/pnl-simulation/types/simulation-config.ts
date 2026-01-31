import type { Erc20Token } from '../../../types/index.js';

export interface SimulationConfig {
  /** Price range for x-axis */
  priceRange: {
    min: bigint;
    max: bigint;
  };
  /** Number of points to generate */
  numPoints: number;
  /** Quote token (PnL denominated in this) */
  quoteToken: Erc20Token;
  /** Base token (x-axis price) */
  baseToken: Erc20Token;
  /** Starting price for simulation */
  startingPrice: bigint;
  /** Cost basis override (optional) */
  costBasis?: bigint;
  /** Include unclaimed fees in PnL */
  includeUnclaimedFees?: boolean;
}
