/**
 * SwapRouterService Error Classes
 *
 * Custom errors for specific failure modes in the swap parameter computation pipeline.
 */

/**
 * Failed to read swap token whitelist from MidcurveSwapRouter contract.
 */
export class SwapTokenReadError extends Error {
  constructor(
    public readonly chainId: number,
    public readonly routerAddress: string,
    cause?: unknown
  ) {
    super(
      `Failed to read swap tokens from MidcurveSwapRouter at ${routerAddress} on chain ${chainId}`
    );
    this.name = 'SwapTokenReadError';
    this.cause = cause;
  }
}

/**
 * Failed to read position data from NonfungiblePositionManager.
 */
export class PositionReadError extends Error {
  constructor(
    public readonly chainId: number,
    public readonly nftId: bigint,
    cause?: unknown
  ) {
    super(
      `Failed to read position data for NFT #${nftId} on chain ${chainId}`
    );
    this.name = 'PositionReadError';
    this.cause = cause;
  }
}

/**
 * Failed to discover pools from UniswapV3 Factory.
 */
export class PoolDiscoveryError extends Error {
  constructor(
    public readonly chainId: number,
    public readonly phase: 'backbone' | 'edge',
    cause?: unknown
  ) {
    super(
      `Failed to discover ${phase} pools on chain ${chainId}`
    );
    this.name = 'PoolDiscoveryError';
    this.cause = cause;
  }
}

/**
 * Failed to fetch fair value prices from CoinGecko.
 */
export class FairValuePriceError extends Error {
  constructor(
    public readonly tokenAddress: string,
    public readonly reason: string,
    cause?: unknown
  ) {
    super(
      `Failed to get fair value price for ${tokenAddress}: ${reason}`
    );
    this.name = 'FairValuePriceError';
    this.cause = cause;
  }
}
