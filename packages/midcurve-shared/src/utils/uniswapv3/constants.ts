import { FEE_TIERS, type FeeTier } from './types.js';

// BigInt constants for precise calculations
export const Q96 = 1n << 96n;
export const Q128 = 1n << 128n;
export const Q192 = 1n << 192n;

// Re-export fee tiers for convenience
export { FEE_TIERS };
export type { FeeTier };

// Tick spacing by fee tier
export const TICK_SPACINGS: Record<FeeTier, number> = {
  100: 1, // 0.01%
  500: 10, // 0.05%
  3000: 60, // 0.3%
  10000: 200, // 1%
} as const;
