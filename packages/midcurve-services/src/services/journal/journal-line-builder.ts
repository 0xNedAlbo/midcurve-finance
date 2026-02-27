/**
 * JournalLineBuilder
 *
 * Declarative helper for constructing balanced journal entry lines.
 * Ensures the fundamental accounting invariant: total debits = total credits.
 */

import type { JournalLineInput, JournalSide } from '@midcurve/shared';

export class JournalLineBuilder {
  private readonly lines: JournalLineInput[] = [];

  debit(accountCode: number, amountQuote: string, instrumentRef?: string): this {
    this.lines.push({
      accountCode,
      instrumentRef,
      side: 'debit' as JournalSide,
      amountQuote,
    });
    return this;
  }

  credit(accountCode: number, amountQuote: string, instrumentRef?: string): this {
    this.lines.push({
      accountCode,
      instrumentRef,
      side: 'credit' as JournalSide,
      amountQuote,
    });
    return this;
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
