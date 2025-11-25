/**
 * Risk Asset Registry
 *
 * Maps on-chain tokens to economic risk assets.
 * This is configuration data, not stored in DB.
 */

import type { RiskAsset, RiskAssetId } from '@midcurve/shared';

/**
 * Token key format: "address:chainId" (lowercase address)
 */
type TokenKey = string;

/**
 * Risk Asset Registry
 *
 * Singleton that maps on-chain tokens to economic risk assets.
 * Provides token → RiskAsset lookup for risk calculations.
 *
 * @example
 * const registry = RiskAssetRegistry.getInstance();
 * const asset = registry.getRiskAsset('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 1);
 * // asset = { id: 'ETH', role: 'volatile', displayName: 'Ethereum' }
 */
export class RiskAssetRegistry {
  private static instance: RiskAssetRegistry;

  private tokenToAsset: Map<TokenKey, RiskAsset> = new Map();
  private assetDefinitions: Map<RiskAssetId, RiskAsset> = new Map();

  private constructor() {
    this.initializeDefaults();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): RiskAssetRegistry {
    if (!RiskAssetRegistry.instance) {
      RiskAssetRegistry.instance = new RiskAssetRegistry();
    }
    return RiskAssetRegistry.instance;
  }

  /**
   * Get risk asset for a token
   *
   * @param address - Token contract address (any case)
   * @param chainId - Chain ID
   * @returns Risk asset or OTHER fallback
   */
  getRiskAsset(address: string, chainId: number): RiskAsset {
    const key = this.makeKey(address, chainId);
    return this.tokenToAsset.get(key) ?? this.getOtherAsset();
  }

  /**
   * Get risk asset definition by ID
   */
  getAssetDefinition(assetId: RiskAssetId): RiskAsset | undefined {
    return this.assetDefinitions.get(assetId);
  }

  /**
   * Check if a token is mapped to a known risk asset (not OTHER)
   */
  isKnownToken(address: string, chainId: number): boolean {
    const key = this.makeKey(address, chainId);
    return this.tokenToAsset.has(key);
  }

  /**
   * Create token key from address and chainId
   */
  private makeKey(address: string, chainId: number): TokenKey {
    return `${address.toLowerCase()}:${chainId}`;
  }

  /**
   * Get the OTHER fallback asset
   */
  private getOtherAsset(): RiskAsset {
    return this.assetDefinitions.get('OTHER')!;
  }

  /**
   * Initialize default asset definitions and token mappings
   */
  private initializeDefaults(): void {
    // Define all risk assets
    const assets: RiskAsset[] = [
      { id: 'ETH', role: 'volatile', displayName: 'Ethereum' },
      { id: 'BTC', role: 'volatile', displayName: 'Bitcoin' },
      { id: 'USD', role: 'stable', displayName: 'US Dollar' },
      { id: 'EUR', role: 'stable', displayName: 'Euro' },
      { id: 'SOL', role: 'volatile', displayName: 'Solana' },
      { id: 'OTHER', role: 'other', displayName: 'Other' },
    ];

    for (const asset of assets) {
      this.assetDefinitions.set(asset.id, asset);
    }

    // Register token mappings
    this.registerTokenMappings();
  }

  /**
   * Register all token → risk asset mappings
   */
  private registerTokenMappings(): void {
    const eth = this.assetDefinitions.get('ETH')!;
    const btc = this.assetDefinitions.get('BTC')!;
    const usd = this.assetDefinitions.get('USD')!;

    // ==========================================================================
    // ETH mappings (WETH on various chains)
    // ==========================================================================
    const ethTokens: TokenKey[] = [
      // Ethereum Mainnet (chainId: 1)
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2:1', // WETH

      // Arbitrum One (chainId: 42161)
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1:42161', // WETH

      // Base (chainId: 8453)
      '0x4200000000000000000000000000000000000006:8453', // WETH

      // Optimism (chainId: 10)
      '0x4200000000000000000000000000000000000006:10', // WETH

      // Polygon (chainId: 137)
      '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619:137', // WETH (bridged)

      // BSC (chainId: 56)
      '0x2170ed0880ac9a755fd29b2688956bd959f933f8:56', // WETH (bridged)
    ];
    for (const key of ethTokens) {
      this.tokenToAsset.set(key, eth);
    }

    // ==========================================================================
    // BTC mappings
    // ==========================================================================
    const btcTokens: TokenKey[] = [
      // Ethereum Mainnet (chainId: 1)
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599:1', // WBTC

      // Arbitrum One (chainId: 42161)
      '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f:42161', // WBTC

      // Optimism (chainId: 10)
      '0x68f180fcce6836688e9084f035309e29bf0a2095:10', // WBTC

      // Base (chainId: 8453)
      '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf:8453', // cbBTC
    ];
    for (const key of btcTokens) {
      this.tokenToAsset.set(key, btc);
    }

    // ==========================================================================
    // USD stablecoin mappings
    // ==========================================================================
    const usdTokens: TokenKey[] = [
      // ----- USDC -----
      // Ethereum Mainnet
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48:1',
      // Arbitrum One
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831:42161', // Native USDC
      '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8:42161', // USDC.e (bridged)
      // Base
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913:8453',
      // Optimism
      '0x0b2c639c533813f4aa9d7837caf62653d097ff85:10', // Native USDC
      '0x7f5c764cbc14f9669b88837ca1490cca17c31607:10', // USDC.e (bridged)
      // BSC
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d:56',
      // Polygon
      '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359:137', // Native USDC
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174:137', // USDC.e (bridged)

      // ----- USDT -----
      // Ethereum Mainnet
      '0xdac17f958d2ee523a2206206994597c13d831ec7:1',
      // Arbitrum One
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9:42161',
      // BSC
      '0x55d398326f99059ff775485246999027b3197955:56',
      // Polygon
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f:137',
      // Optimism
      '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58:10',

      // ----- DAI -----
      // Ethereum Mainnet
      '0x6b175474e89094c44da98b954eedeac495271d0f:1',
      // Arbitrum One
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1:42161',
      // Base
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb:8453',
      // Optimism
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1:10',
      // Polygon
      '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063:137',

      // ----- FRAX -----
      // Ethereum Mainnet
      '0x853d955acef822db058eb8505911ed77f175b99e:1',
      // Arbitrum One
      '0x17fc002b466eec40dae837fc4be5c67993ddbd6f:42161',
    ];
    for (const key of usdTokens) {
      this.tokenToAsset.set(key, usd);
    }
  }
}
