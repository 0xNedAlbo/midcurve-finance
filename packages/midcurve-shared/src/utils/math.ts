/**
 * Mathematical utilities for exact calculations
 */

/**
 * Represents an exact fraction with numerator and denominator
 */
export interface Fraction<T = bigint> {
  /** Numerator */
  num: T;
  /** Denominator */
  den: T;
}

/**
 * Calculates the greatest common divisor of two BigInts using Euclidean algorithm
 * @param a - First BigInt
 * @param b - Second BigInt
 * @returns Greatest common divisor as BigInt
 */
export function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;

  while (b !== 0n) {
    const temp = b;
    b = a % b;
    a = temp;
  }

  return a;
}

/**
 * Simplifies a fraction by dividing both numerator and denominator by their GCD
 * @param fraction - The fraction to simplify
 * @returns Simplified fraction with reduced numerator and denominator
 */
export function simplifyFraction(fraction: Fraction<bigint>): Fraction<bigint> {
  if (fraction.den === 0n) {
    throw new Error('Denominator cannot be zero');
  }

  const divisor = gcd(fraction.num, fraction.den);

  return {
    num: fraction.num / divisor,
    den: fraction.den / divisor,
  };
}

/**
 * Creates a fraction from a decimal number and decimal places
 * @param value - The decimal value as string
 * @param decimals - Number of decimal places
 * @returns Fraction representing the exact value
 */
export function decimalToFraction(
  value: string,
  decimals: number = 18
): Fraction<bigint> {
  const [integerPart = '0', fractionalPart = ''] = value.split('.');
  const paddedFractional = fractionalPart
    .padEnd(decimals, '0')
    .slice(0, decimals);
  const fullString = integerPart + paddedFractional;

  return {
    num: BigInt(fullString),
    den: 10n ** BigInt(decimals),
  };
}

export function mulDiv(a: bigint, b: bigint, denom: bigint): bigint {
  // floor(a*b/denom)
  return (a * b) / denom;
}

export function mulDivRoundingUp(a: bigint, b: bigint, denom: bigint): bigint {
  // ceil(a*b/denom)
  const product = a * b;
  return product % denom === 0n ? product / denom : product / denom + 1n;
}
