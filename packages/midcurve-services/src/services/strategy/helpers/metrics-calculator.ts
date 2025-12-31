/**
 * Strategy Metrics Calculator
 *
 * Error classes for strategy metrics validation.
 *
 * NOTE: Strategy metrics are NOT stored in the database.
 * They are computed on-demand by StrategyMetricsService from:
 * - StrategyLedgerEvent records (realized metrics)
 * - Position state calculations (unrealized metrics)
 */

/**
 * Error thrown when quote tokens don't match
 */
export class StrategyQuoteTokenMismatchError extends Error {
  public readonly strategyId: string;
  public readonly strategyQuoteTokenId: string;
  public readonly positionQuoteTokenId: string;

  constructor(
    strategyId: string,
    strategyQuoteTokenId: string,
    positionQuoteTokenId: string
  ) {
    super(
      `Quote token mismatch for strategy ${strategyId}: ` +
        `strategy uses ${strategyQuoteTokenId}, ` +
        `but position uses ${positionQuoteTokenId}. ` +
        `All positions in a strategy must use the same quote token.`
    );
    this.name = 'StrategyQuoteTokenMismatchError';
    this.strategyId = strategyId;
    this.strategyQuoteTokenId = strategyQuoteTokenId;
    this.positionQuoteTokenId = positionQuoteTokenId;
  }
}

/**
 * Error thrown when a position's quote token is not linked to a basic currency
 */
export class PositionNoBasicCurrencyError extends Error {
  public readonly positionId: string;
  public readonly quoteTokenId: string;
  public readonly quoteTokenSymbol: string;

  constructor(
    positionId: string,
    quoteTokenId: string,
    quoteTokenSymbol: string
  ) {
    super(
      `Position ${positionId} has quote token ${quoteTokenSymbol} (${quoteTokenId}) ` +
        `which is not linked to any basic currency. ` +
        `Link the quote token to a basic currency before adding to a strategy.`
    );
    this.name = 'PositionNoBasicCurrencyError';
    this.positionId = positionId;
    this.quoteTokenId = quoteTokenId;
    this.quoteTokenSymbol = quoteTokenSymbol;
  }
}

/**
 * Error thrown when a position's basic currency doesn't match the strategy's basic currency
 */
export class StrategyBasicCurrencyMismatchError extends Error {
  public readonly strategyId: string;
  public readonly strategyBasicCurrencyId: string;
  public readonly positionBasicCurrencyId: string;

  constructor(
    strategyId: string,
    strategyBasicCurrencyId: string,
    positionBasicCurrencyId: string
  ) {
    super(
      `Basic currency mismatch for strategy ${strategyId}: ` +
        `strategy uses basic currency ${strategyBasicCurrencyId}, ` +
        `but position's quote token is linked to ${positionBasicCurrencyId}. ` +
        `All positions in a strategy must use quote tokens linked to the same basic currency.`
    );
    this.name = 'StrategyBasicCurrencyMismatchError';
    this.strategyId = strategyId;
    this.strategyBasicCurrencyId = strategyBasicCurrencyId;
    this.positionBasicCurrencyId = positionBasicCurrencyId;
  }
}
