// fraction-format.ts
// Utilities to render exact crypto prices/ranges from Fraction<bigint> without rounding,
// with thousands separators and a "zero-skip" notation for tiny values.
// Example: 0.₍7₎1234… instead of 0.00000001234

import type { Fraction } from "./math";

export type { Fraction };

export type FormatOpts = {
  /** Thousands separator, e.g. "." for de-DE, "," for en-US */
  groupSep?: string;
  /** Decimal separator, e.g. "," for de-DE, "." for en-US */
  decimalSep?: string;
  /** Use Unicode subscript for zero-skip (e.g. 0.₍7₎1234) instead of ASCII fallback 0.(7)1234 */
  useSubscript?: boolean;
  /** How many digits to display after the skipped zeros (no rounding). Default 8. */
  mantissaDigits?: number;
  /**
   * Safety cap for digits produced by long division (no rounding; an ellipsis "…" is appended if truncated).
   * Default 200.
   */
  maxFracDigits?: number;
};

// Convenient presets
export const FORMAT_PRESET_EN: Required<FormatOpts> = {
  groupSep: ",",
  decimalSep: ".",
  useSubscript: true,
  mantissaDigits: 8,
  maxFracDigits: 200,
};

export const FORMAT_PRESET_DE: Required<FormatOpts> = {
  groupSep: ".",
  decimalSep: ",",
  useSubscript: true,
  mantissaDigits: 8,
  maxFracDigits: 200,
};

// -----------------------------
// Core conversion (exact, no rounding)
// -----------------------------

export type DecimalParts = {
  /** -1, 0, +1 (sign of the value) */
  sign: -1 | 0 | 1;
  /** Integer part (no sign), e.g. "0", "12", "123456" */
  intPart: string;
  /**
   * Fractional digits string (no decimal separator). May be long, up to `maxFracDigits`.
   * No trailing trimming is applied; if long division was truncated, `truncated` is true.
   */
  fracDigits: string;
  /** True if the fractional expansion was truncated at maxFracDigits. */
  truncated: boolean;
};

/**
 * Converts an exact fraction (bigint) into decimal parts via long division.
 * Produces at most `maxFracDigits` fractional digits. Does not round.
 */
export function fractionToDecimalParts(
  fr: Fraction<bigint>,
  maxFracDigits: number = FORMAT_PRESET_EN.maxFracDigits
): DecimalParts {
  const { num, den } = fr;
  if (den === 0n) throw new Error("Division by zero");
  if (num === 0n) {
    return { sign: 0, intPart: "0", fracDigits: "", truncated: false };
  }

  const s: -1 | 1 = ((num < 0n ? -1 : 1) * (den < 0n ? -1 : 1)) as -1 | 1;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;

  const intPartBig = n / d;
  let r = n % d;

  const intPart = intPartBig.toString();
  let fracDigits = "";
  let truncated = false;

  for (let i = 0; i < maxFracDigits && r !== 0n; i++) {
    r *= 10n;
    const digit = r / d; // 0..9
    r = r % d;
    fracDigits += digit.toString();
  }
  if (r !== 0n) truncated = true;

  return { sign: s, intPart, fracDigits, truncated };
}

// -----------------------------
// Human-friendly formatting
// -----------------------------

/** Internal: group integer digits with a thousands separator. Keeps/handles a leading "-". */
function groupThousands(intStr: string, sep: string): string {
  if (intStr === "" || intStr === "-") return intStr;
  const isNeg = intStr[0] === "-";
  const core = isNeg ? intStr.slice(1) : intStr;
  // Insert separator between every group of three from the right
  const grouped = core.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return isNeg ? "-" + grouped : grouped;
}

function toSubscript(n: number): string {
  // Unicode subscripts for 0-9 and parentheses
  const map: Record<string, string> = {
    "0": "₀",
    "1": "₁",
    "2": "₂",
    "3": "₃",
    "4": "₄",
    "5": "₅",
    "6": "₆",
    "7": "₇",
    "8": "₈",
    "9": "₉",
  };
  const s = String(n)
    .split("")
    .map((c) => map[c] ?? c)
    .join("");
  return "₍" + s + "₎";
}

/**
 * Formats a Fraction<bigint, bigint> into a readable string:
 *  - Thousands grouping for large integers
 *  - No scientific notation
 *  - No rounding
 *  - "Zero-skip" notation for tiny values: 0.₍7₎1234… (or 0.(7)1234… if useSubscript=false)
 */
export function formatFractionHuman(
  fr: Fraction<bigint>,
  opts?: FormatOpts
): string {
  // Handle zero case to avoid "0." output
  if (fr.num === 0n) {
    return "0";
  }

  const { groupSep, decimalSep, useSubscript, mantissaDigits, maxFracDigits } = {
    ...FORMAT_PRESET_EN,
    ...opts,
  };

  const { sign, intPart, fracDigits, truncated } = fractionToDecimalParts(
    fr,
    maxFracDigits
  );

  const signStr = sign < 0 ? "-" : "";

  // Large / normal (integer part non-zero): group integer and append fractional part as-is (no rounding)
  if (intPart !== "0") {
    const grouped = groupThousands(intPart, groupSep);
    if (!fracDigits) return signStr + grouped;
    return signStr + grouped + decimalSep + fracDigits + (truncated ? "…" : "");
  }

  // Small values: count leading zeros after decimal point
  let zeros = 0;
  while (zeros < fracDigits.length && fracDigits[zeros] === "0") zeros++;

  // If there are no leading zeros (e.g., 0.1234…)
  if (zeros === 0) {
    const tail = fracDigits.slice(0, mantissaDigits);
    const hasMore = fracDigits.length > tail.length || truncated;
    return signStr + "0" + decimalSep + tail + (hasMore ? "…" : "");
  }

  // Use zero-skip notation only for 4+ leading zeros, otherwise show normally
  if (zeros >= 4) {
    const skip = useSubscript ? toSubscript(zeros) : `(${zeros})`;
    const tail = fracDigits.slice(zeros, zeros + mantissaDigits);
    const hasMore = fracDigits.length > zeros + tail.length || truncated;
    return signStr + "0." + skip + tail + (hasMore ? "…" : "");
  } else {
    // For 1-3 leading zeros, show them normally
    const normalZeros = "0".repeat(zeros);
    const tail = fracDigits.slice(zeros, zeros + mantissaDigits);
    const hasMore = fracDigits.length > zeros + tail.length || truncated;
    return (
      signStr + "0" + decimalSep + normalZeros + tail + (hasMore ? "…" : "")
    );
  }
}

export function formatHumanWithDecimals(
  value: bigint,
  decimals?: number,
  opts?: FormatOpts
): string {
  // Handle zero case to avoid "0." output
  if (value === 0n) {
    return "0";
  }

  return formatFractionHuman(
    {
      num: value,
      den: 10n ** BigInt(decimals || 18),
    },
    { ...opts }
  );
}

export function formatCompactValue(
  value: bigint,
  decimals?: number,
  opts?: FormatOpts
): string {
  // Handle zero case
  if (value === 0n) {
    return "0";
  }

  // Get the full formatted string first
  const fullFormatted = formatHumanWithDecimals(value, decimals, opts);

  // Check if the absolute value is >= 1 by comparing to the denominator
  const denominator = 10n ** BigInt(decimals || 18);
  const absValue = value < 0n ? -value : value;
  const isGreaterOrEqualToOne = absValue >= denominator;

  // If less than 1, use compact format with zero-skip notation
  if (!isGreaterOrEqualToOne) {
    // Check if the full formatted string uses zero-skip notation (subscript)
    if (fullFormatted.includes("₍") || fullFormatted.includes("(")) {
      // Already in zero-skip format, return as is (it's already compact)
      return fullFormatted;
    }

    // For regular decimal format, show up to 6 significant digits after leading zeros
    const decimalSep = opts?.decimalSep ?? FORMAT_PRESET_EN.decimalSep;
    const parts = fullFormatted.split(decimalSep);

    // If no decimal part, return as is
    if (parts.length === 1) {
      return fullFormatted;
    }

    const decimalPart = parts[1];

    // Find first non-zero digit
    let firstNonZeroIndex = 0;
    while (
      firstNonZeroIndex < decimalPart.length &&
      decimalPart[firstNonZeroIndex] === "0"
    ) {
      firstNonZeroIndex++;
    }

    // If all zeros or no significant digits, return "0"
    if (firstNonZeroIndex >= decimalPart.length) {
      return "0";
    }

    // Take up to 3 significant digits after the leading zeros
    const significantPart = decimalPart.substring(
      firstNonZeroIndex,
      firstNonZeroIndex + 3
    );
    const leadingZeros = decimalPart.substring(0, firstNonZeroIndex);

    // Limit to max 3 leading zeros for readability
    if (firstNonZeroIndex <= 3) {
      return parts[0] + decimalSep + leadingZeros + significantPart;
    } else {
      // Use zero-skip notation for more than 3 leading zeros
      const useSubscript = opts?.useSubscript ?? FORMAT_PRESET_EN.useSubscript;
      const zeroCount = firstNonZeroIndex;
      const zeroSkip = useSubscript ? `₍${zeroCount}₎` : `(${zeroCount})`;
      return parts[0] + decimalSep + zeroSkip + significantPart;
    }
  }

  // For values >= 1, truncate to max 2 decimal places
  const decimalSep = opts?.decimalSep ?? FORMAT_PRESET_EN.decimalSep;
  const parts = fullFormatted.split(decimalSep);

  // If no decimal part, add .00
  if (parts.length === 1) {
    return fullFormatted + decimalSep + "00";
  }

  // Truncate decimal part to 2 digits (no rounding, just truncation)
  const truncatedDecimal = parts[1].substring(0, 2);

  // Always pad to 2 decimal places with zeros
  const paddedDecimal = truncatedDecimal.padEnd(2, "0");

  return parts[0] + decimalSep + paddedDecimal;
}

/**
 * Formats a range A..B with emphasis on the differing tail for tiny values.
 * Behavior:
 *  - If integer parts differ (or both are non-zero integers), prints both separately.
 *  - If both < 1 and share the same zero-run length, shows the common part once:
 *      0.₍6₎1234[56–99]…
 *  - No rounding; ellipsis "…" if truncated by maxFracDigits.
 */
export function formatFractionRangeHuman(
  a: Fraction<bigint>,
  b: Fraction<bigint>,
  opts?: FormatOpts
): string {
  const o = { ...FORMAT_PRESET_EN, ...opts };
  const A = fractionToDecimalParts(a, o.maxFracDigits);
  const B = fractionToDecimalParts(b, o.maxFracDigits);

  // If integer parts differ or both not "0", show separately
  if (A.intPart !== B.intPart || A.intPart !== "0") {
    const left = formatFractionHuman(a, o);
    const right = formatFractionHuman(b, o);
    return `${left} – ${right}`;
  }

  // Both < 1: compare leading zero runs
  const zA = (A.fracDigits.match(/^0*/) ?? [""])[0].length;
  const zB = (B.fracDigits.match(/^0*/) ?? [""])[0].length;

  if (zA !== zB || zA < 4) {
    const left = formatFractionHuman(a, o);
    const right = formatFractionHuman(b, o);
    return `${left} – ${right}`;
  }

  // Same zero-run with 4+ zeros: compress it and surface differences
  const zeros = zA;
  const skip = o.useSubscript ? toSubscript(zeros) : `(${zeros})`;

  const tailA = A.fracDigits.slice(zeros);
  const tailB = B.fracDigits.slice(zeros);

  // Find common prefix length
  let k = 0;
  while (k < tailA.length && k < tailB.length && tailA[k] === tailB[k]) k++;

  // Common prefix visible once
  const common = tailA.slice(0, k);

  // Remaining tails (limit to mantissaDigits, no rounding)
  const remA = tailA.slice(k, k + Math.max(0, o.mantissaDigits - common.length));
  const remB = tailB.slice(k, k + Math.max(0, o.mantissaDigits - common.length));

  const moreA = tailA.length > k + remA.length || A.truncated;
  const moreB = tailB.length > k + remB.length || B.truncated;

  // If there is no differing remainder (identical up to shown digits), still show brackets with ∅
  const leftRest = remA || "∅";
  const rightRest = remB || "∅";
  const dots = moreA || moreB ? "…" : "";

  return `0.${skip}${common}[${leftRest}–${rightRest}]${dots}`;
}

export function formatFractionAsPreciseString(fr: Fraction<bigint>): string {
  return ((fr.num * 10n ** 18n) / fr.den / 10n ** 18n).toString();
}

// -----------------------------
// Optional helpers
// -----------------------------

/** Quick formatter for integers (BigInt) with grouping only. */
export function formatIntegerGrouped(
  value: bigint,
  opts?: Pick<FormatOpts, "groupSep">
): string {
  const groupSep = opts?.groupSep ?? FORMAT_PRESET_EN.groupSep;
  return groupThousands(value.toString(), groupSep);
}

/** Merge custom options with a preset (defaults to en-US). */
export function withPreset(
  partial: FormatOpts,
  preset: Required<FormatOpts> = FORMAT_PRESET_EN
): Required<FormatOpts> {
  return { ...preset, ...partial };
}
