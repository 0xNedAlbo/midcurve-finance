import type { PriceOracle, Denomination } from './price-oracle.js';

/**
 * Oracle that uses user-provided prices.
 * No API calls - fully client-side.
 */
export class UserProvidedOracle implements PriceOracle {
  /**
   * @param prices Map of "tokenAddress:denominationAddress" -> price
   * @param decimals Map of tokenAddress -> decimals
   */
  constructor(
    private readonly prices: Map<string, bigint>,
    private readonly decimals: Map<string, number>
  ) {}

  private getKey(token: Denomination, denomination: Denomination): string {
    const tokenId =
      token === 'USD' ? 'USD' : token.typedConfig.address.toLowerCase();
    const denomId =
      denomination === 'USD'
        ? 'USD'
        : denomination.typedConfig.address.toLowerCase();
    return `${tokenId}:${denomId}`;
  }

  getPrice(token: Denomination, denomination: Denomination): bigint {
    const key = this.getKey(token, denomination);
    const price = this.prices.get(key);
    if (price === undefined) {
      throw new Error(`Price not found for ${key}`);
    }
    return price;
  }

  convert(amount: bigint, from: Denomination, to: Denomination): bigint {
    if (from === to) return amount;
    const price = this.getPrice(from, to);
    const fromDecimals =
      from === 'USD'
        ? 6
        : this.decimals.get(from.typedConfig.address.toLowerCase()) ?? 18;
    return (amount * price) / 10n ** BigInt(fromDecimals);
  }
}
