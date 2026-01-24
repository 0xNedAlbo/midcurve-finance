import type { TokenInterface } from './token.interface';
import type { TokenRow, TokenType } from './token.types';
import { BasicCurrencyToken } from './basic-currency';
import { Erc20Token } from './erc20';

/**
 * Token factory for creating token instances from database rows.
 *
 * Routes to the appropriate concrete class based on the tokenType discriminator.
 *
 * @example
 * ```typescript
 * // In service layer:
 * const dbRow = await prisma.token.findUnique({ where: { id } });
 * const token = TokenFactory.fromDB(dbRow);
 *
 * // Type narrowing:
 * if (token.tokenType === 'erc20') {
 *   console.log((token as Erc20Token).address);
 * }
 * ```
 */
export class TokenFactory {
  /**
   * Create a token instance from a database row.
   *
   * @param row - Database row from Prisma Token model
   * @returns TokenInterface instance (Erc20Token or BasicCurrencyToken)
   * @throws Error if tokenType is unknown
   */
  static fromDB(row: TokenRow): TokenInterface {
    const tokenType = row.tokenType as TokenType;

    switch (tokenType) {
      case 'erc20':
        return Erc20Token.fromDB({ ...row, tokenType: 'erc20' });

      case 'basic-currency':
        return BasicCurrencyToken.fromDB({ ...row, tokenType: 'basic-currency' });

      default:
        throw new Error(`Unknown token type: ${row.tokenType}`);
    }
  }

  /**
   * Check if a token type is supported.
   *
   * @param tokenType - Token type string to check
   * @returns True if the token type is supported
   */
  static isSupported(tokenType: string): tokenType is TokenType {
    return ['erc20', 'basic-currency'].includes(tokenType);
  }
}
