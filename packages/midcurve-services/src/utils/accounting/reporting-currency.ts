/**
 * Reporting Currency Conversion
 *
 * Converts quote token amounts (bigint strings in raw token units) to a
 * user's reporting currency using CoinGecko spot prices.
 *
 * All reporting amounts use 10^8 scaling (8 decimal places).
 * Example: $3,000.50 → "300050000000"
 */

const FLOAT_TO_BIGINT_SCALE = 1e8;

export interface ReportingConversion {
  /** Amount in reporting currency (bigint string, scaled by 10^8) */
  amountReporting: string;
  /** Exchange rate: quote token → reporting currency (bigint string, scaled by 10^8) */
  exchangeRate: string;
}

/**
 * Convert a quote token amount to reporting currency.
 *
 * @param amountQuoteRaw - Amount in quote token smallest units (e.g., "2000000000" for 2000 USDC with 6 decimals)
 * @param quoteTokenUsdPrice - USD price of 1 whole quote token (from CoinGecko, e.g., 1.0 for USDC)
 * @param reportingCurrencyUsdPrice - USD price of 1 unit of reporting currency (1.0 for USD, ~0.92 for EUR)
 * @param quoteTokenDecimals - Decimals of the quote token (e.g., 6 for USDC, 18 for WETH)
 */
export function convertToReportingCurrency(
  amountQuoteRaw: string,
  quoteTokenUsdPrice: number,
  reportingCurrencyUsdPrice: number,
  quoteTokenDecimals: number
): ReportingConversion {
  // Exchange rate: price of 1 whole quote token in reporting currency
  // e.g., for USDC→USD: 1.0 / 1.0 = 1.0
  // e.g., for WETH→USD: 2000.0 / 1.0 = 2000.0
  // e.g., for USDC→EUR: 1.0 / 1.09 ≈ 0.917
  const rate = quoteTokenUsdPrice / reportingCurrencyUsdPrice;
  const exchangeRateScaled = BigInt(Math.round(rate * FLOAT_TO_BIGINT_SCALE));

  // Convert raw amount to reporting currency:
  // amountReporting = (amountQuoteRaw * exchangeRate_scaled) / 10^quoteDecimals
  //
  // This works because:
  // - amountQuoteRaw is in smallest units (e.g., 2000_000000 for 2000 USDC)
  // - exchangeRateScaled is price-per-whole-token × 10^8
  // - Dividing by 10^quoteDecimals converts from smallest units to whole tokens
  // - Result is in reporting currency × 10^8
  const amount = BigInt(amountQuoteRaw);
  const quoteDecimals = 10n ** BigInt(quoteTokenDecimals);
  const amountReporting = (amount * exchangeRateScaled) / quoteDecimals;

  return {
    amountReporting: amountReporting.toString(),
    exchangeRate: exchangeRateScaled.toString(),
  };
}
