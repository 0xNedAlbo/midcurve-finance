/**
 * JournalLineBuilder
 *
 * Declarative helper for constructing balanced journal entry lines.
 * Ensures the fundamental accounting invariant: total debits = total credits.
 */

import type { JournalLineInput, JournalSide } from '@midcurve/shared';

export class JournalLineBuilder {
  private readonly lines: JournalLineInput[] = [];

  /** Reporting currency context (set via withReporting) */
  private reportingCtx: {
    reportingCurrency: string;
    exchangeRate: bigint;
    quoteTokenDecimals: bigint;
  } | null = null;

  /**
   * Sets reporting currency context for all subsequent lines.
   * When set, amountReporting is auto-computed for each debit/credit call.
   *
   * @param reportingCurrency - ISO 4217 code (e.g., "USD")
   * @param exchangeRate - Quote token → reporting currency rate as bigint string (scaled 10^8)
   * @param quoteTokenDecimals - Decimals of the quote token (e.g., 6 for USDC)
   */
  withReporting(reportingCurrency: string, exchangeRate: string, quoteTokenDecimals: number): this {
    this.reportingCtx = {
      reportingCurrency,
      exchangeRate: BigInt(exchangeRate),
      quoteTokenDecimals: BigInt(quoteTokenDecimals),
    };
    return this;
  }

  debit(accountCode: number, amountQuote: string, instrumentRef?: string): this {
    this.lines.push(this.buildLine(accountCode, amountQuote, 'debit', instrumentRef));
    return this;
  }

  credit(accountCode: number, amountQuote: string, instrumentRef?: string): this {
    this.lines.push(this.buildLine(accountCode, amountQuote, 'credit', instrumentRef));
    return this;
  }

  private buildLine(
    accountCode: number,
    amountQuote: string,
    side: JournalSide,
    instrumentRef?: string
  ): JournalLineInput {
    const line: JournalLineInput = { accountCode, instrumentRef, side, amountQuote };

    if (this.reportingCtx) {
      const { reportingCurrency, exchangeRate, quoteTokenDecimals } = this.reportingCtx;
      const amountReporting = (BigInt(amountQuote) * exchangeRate) / (10n ** quoteTokenDecimals);
      line.amountReporting = amountReporting.toString();
      line.reportingCurrency = reportingCurrency;
      line.exchangeRate = exchangeRate.toString();
    }

    return line;
  }

  /**
   * Returns the accumulated lines. Throws if debits !== credits.
   */
  build(): JournalLineInput[] {
    if (this.lines.length === 0) {
      throw new Error('JournalLineBuilder: no lines added');
    }

    let totalDebits = 0n;
    let totalCredits = 0n;

    for (const line of this.lines) {
      const amount = BigInt(line.amountQuote);
      if (amount <= 0n) {
        throw new Error(
          `JournalLineBuilder: line amount must be positive, got ${line.amountQuote} for account ${line.accountCode}`
        );
      }
      if (line.side === 'debit') {
        totalDebits += amount;
      } else {
        totalCredits += amount;
      }
    }

    if (totalDebits !== totalCredits) {
      throw new Error(
        `JournalLineBuilder: unbalanced entry — debits=${totalDebits.toString()} credits=${totalCredits.toString()}`
      );
    }

    return this.lines;
  }
}
