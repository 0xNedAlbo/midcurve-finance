/**
 * APR Calculation Utilities - Barrel Export
 */

export {
  calculateAprBps,
  calculateDurationSeconds,
  secondsToDays,
  calculateAverageCostBasis,
  calculateTimeWeightedCostBasis,
  buildUnrealizedWindowSnapshots,
  aprBpsToPercent,
  aprPercentToBps,
  SECONDS_PER_YEAR,
  BASIS_POINTS_MULTIPLIER,
} from './apr-calculations.js';

export type {
  CostBasisSnapshot,
  UnrealizedWindowInput,
} from './apr-calculations.js';
