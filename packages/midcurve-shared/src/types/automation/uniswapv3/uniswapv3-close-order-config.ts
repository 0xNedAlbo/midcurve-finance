/**
 * UniswapV3 Close Order Config
 *
 * Immutable configuration for a UniswapV3 close order.
 * Contains price triggers and execution parameters.
 */

/**
 * Trigger mode for price-based closing
 *
 * - LOWER: Trigger when price falls below sqrtPriceX96Lower
 * - UPPER: Trigger when price rises above sqrtPriceX96Upper
 */
export type TriggerMode = 'LOWER' | 'UPPER';

/**
 * Swap direction for post-close token conversion
 *
 * Uses Uniswap's native token ordering (token0/token1), role-agnostic.
 * - TOKEN0_TO_1: Swap token0 to token1
 * - TOKEN1_TO_0: Swap token1 to token0
 */
export type SwapDirection = 'TOKEN0_TO_1' | 'TOKEN1_TO_0';

/**
 * Optional swap configuration for post-close token conversion
 */
export interface SwapConfig {
  /**
   * Whether swap is enabled
   */
  enabled: boolean;

  /**
   * Direction of swap (TOKEN0_TO_1 or TOKEN1_TO_0)
   */
  direction: SwapDirection;

  /**
   * Slippage tolerance in basis points (0-10000)
   */
  slippageBps: number;
}

/**
 * UniswapV3 Close Order Config Data
 *
 * Immutable configuration set at order registration.
 */
export interface UniswapV3CloseOrderConfigData {
  /**
   * On-chain close ID (assigned by contract)
   */
  closeId: number;

  /**
   * NFT token ID of the position
   */
  nftId: bigint;

  /**
   * Pool address being monitored
   */
  poolAddress: string;

  /**
   * Trigger mode (LOWER or UPPER)
   */
  triggerMode: TriggerMode;

  /**
   * Lower price threshold (sqrtPriceX96 format)
   * Trigger when price falls below this value
   */
  sqrtPriceX96Lower: bigint;

  /**
   * Upper price threshold (sqrtPriceX96 format)
   * Trigger when price rises above this value
   */
  sqrtPriceX96Upper: bigint;

  /**
   * Address to receive closed position tokens
   */
  payoutAddress: string;

  /**
   * Operator address (automation service)
   */
  operatorAddress: string;

  /**
   * Order expiration timestamp
   */
  validUntil: Date;

  /**
   * Maximum slippage in basis points (e.g., 50 = 0.5%)
   */
  slippageBps: number;

  /**
   * Optional swap configuration for post-close token conversion
   */
  swapConfig?: SwapConfig;
}

/**
 * JSON-serializable representation of config
 */
/**
 * JSON-serializable swap config
 */
export interface SwapConfigJSON {
  enabled: boolean;
  direction: SwapDirection;
  slippageBps: number;
}

export interface UniswapV3CloseOrderConfigJSON {
  closeId: number;
  nftId: string;
  poolAddress: string;
  triggerMode: TriggerMode;
  sqrtPriceX96Lower: string;
  sqrtPriceX96Upper: string;
  payoutAddress: string;
  operatorAddress: string;
  validUntil: string;
  slippageBps: number;
  swapConfig?: SwapConfigJSON;
}

/**
 * UniswapV3 Close Order Config Class
 *
 * Provides serialization and deserialization methods.
 */
export class UniswapV3CloseOrderConfig implements UniswapV3CloseOrderConfigData {
  readonly closeId: number;
  readonly nftId: bigint;
  readonly poolAddress: string;
  readonly triggerMode: TriggerMode;
  readonly sqrtPriceX96Lower: bigint;
  readonly sqrtPriceX96Upper: bigint;
  readonly payoutAddress: string;
  readonly operatorAddress: string;
  readonly validUntil: Date;
  readonly slippageBps: number;
  readonly swapConfig?: SwapConfig;

  constructor(data: UniswapV3CloseOrderConfigData) {
    this.closeId = data.closeId;
    this.nftId = data.nftId;
    this.poolAddress = data.poolAddress;
    this.triggerMode = data.triggerMode;
    this.sqrtPriceX96Lower = data.sqrtPriceX96Lower;
    this.sqrtPriceX96Upper = data.sqrtPriceX96Upper;
    this.payoutAddress = data.payoutAddress;
    this.operatorAddress = data.operatorAddress;
    this.validUntil = data.validUntil;
    this.slippageBps = data.slippageBps;
    this.swapConfig = data.swapConfig;
  }

  /**
   * Check if swap is enabled
   */
  hasSwapEnabled(): boolean {
    return this.swapConfig?.enabled === true;
  }

  /**
   * Serialize to JSON-safe object
   */
  toJSON(): UniswapV3CloseOrderConfigJSON {
    return {
      closeId: this.closeId,
      nftId: this.nftId.toString(),
      poolAddress: this.poolAddress,
      triggerMode: this.triggerMode,
      sqrtPriceX96Lower: this.sqrtPriceX96Lower.toString(),
      sqrtPriceX96Upper: this.sqrtPriceX96Upper.toString(),
      payoutAddress: this.payoutAddress,
      operatorAddress: this.operatorAddress,
      validUntil: this.validUntil.toISOString(),
      slippageBps: this.slippageBps,
      swapConfig: this.swapConfig,
    };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: UniswapV3CloseOrderConfigJSON): UniswapV3CloseOrderConfig {
    return new UniswapV3CloseOrderConfig({
      closeId: json.closeId,
      nftId: BigInt(json.nftId),
      poolAddress: json.poolAddress,
      triggerMode: json.triggerMode,
      sqrtPriceX96Lower: BigInt(json.sqrtPriceX96Lower),
      sqrtPriceX96Upper: BigInt(json.sqrtPriceX96Upper),
      payoutAddress: json.payoutAddress,
      operatorAddress: json.operatorAddress,
      validUntil: new Date(json.validUntil),
      slippageBps: json.slippageBps,
      swapConfig: json.swapConfig,
    });
  }
}
