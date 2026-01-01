/**
 * UniswapV3 Close Order State
 *
 * Mutable state for a UniswapV3 close order.
 * Tracks execution progress and results.
 */

/**
 * UniswapV3 Close Order State Data
 *
 * Mutable state updated during order lifecycle.
 */
export interface UniswapV3CloseOrderStateData {
  /**
   * Transaction hash of registration transaction
   */
  registrationTxHash: string | null;

  /**
   * Timestamp when order was registered on-chain
   */
  registeredAt: Date | null;

  /**
   * Timestamp when price threshold was triggered
   */
  triggeredAt: Date | null;

  /**
   * Price at trigger time (sqrtPriceX96 format)
   */
  triggerSqrtPriceX96: bigint | null;

  /**
   * Transaction hash of execution transaction
   */
  executionTxHash: string | null;

  /**
   * Timestamp when execution completed
   */
  executedAt: Date | null;

  /**
   * Actual fee charged (in basis points)
   */
  executionFeeBps: number | null;

  /**
   * Error message if execution failed
   */
  executionError: string | null;

  /**
   * Number of retry attempts
   */
  retryCount: number;

  /**
   * Amount of token0 received after close
   */
  amount0Out: bigint | null;

  /**
   * Amount of token1 received after close
   */
  amount1Out: bigint | null;
}

/**
 * JSON-serializable representation of state
 */
export interface UniswapV3CloseOrderStateJSON {
  registrationTxHash: string | null;
  registeredAt: string | null;
  triggeredAt: string | null;
  triggerSqrtPriceX96: string | null;
  executionTxHash: string | null;
  executedAt: string | null;
  executionFeeBps: number | null;
  executionError: string | null;
  retryCount: number;
  amount0Out: string | null;
  amount1Out: string | null;
}

/**
 * UniswapV3 Close Order State Class
 *
 * Provides serialization and deserialization methods.
 */
export class UniswapV3CloseOrderState implements UniswapV3CloseOrderStateData {
  readonly registrationTxHash: string | null;
  readonly registeredAt: Date | null;
  readonly triggeredAt: Date | null;
  readonly triggerSqrtPriceX96: bigint | null;
  readonly executionTxHash: string | null;
  readonly executedAt: Date | null;
  readonly executionFeeBps: number | null;
  readonly executionError: string | null;
  readonly retryCount: number;
  readonly amount0Out: bigint | null;
  readonly amount1Out: bigint | null;

  constructor(data: Partial<UniswapV3CloseOrderStateData>) {
    this.registrationTxHash = data.registrationTxHash ?? null;
    this.registeredAt = data.registeredAt ?? null;
    this.triggeredAt = data.triggeredAt ?? null;
    this.triggerSqrtPriceX96 = data.triggerSqrtPriceX96 ?? null;
    this.executionTxHash = data.executionTxHash ?? null;
    this.executedAt = data.executedAt ?? null;
    this.executionFeeBps = data.executionFeeBps ?? null;
    this.executionError = data.executionError ?? null;
    this.retryCount = data.retryCount ?? 0;
    this.amount0Out = data.amount0Out ?? null;
    this.amount1Out = data.amount1Out ?? null;
  }

  /**
   * Create an empty state with default values
   */
  static empty(): UniswapV3CloseOrderState {
    return new UniswapV3CloseOrderState({});
  }

  /**
   * Serialize to JSON-safe object
   */
  toJSON(): UniswapV3CloseOrderStateJSON {
    return {
      registrationTxHash: this.registrationTxHash,
      registeredAt: this.registeredAt?.toISOString() ?? null,
      triggeredAt: this.triggeredAt?.toISOString() ?? null,
      triggerSqrtPriceX96: this.triggerSqrtPriceX96?.toString() ?? null,
      executionTxHash: this.executionTxHash,
      executedAt: this.executedAt?.toISOString() ?? null,
      executionFeeBps: this.executionFeeBps,
      executionError: this.executionError,
      retryCount: this.retryCount,
      amount0Out: this.amount0Out?.toString() ?? null,
      amount1Out: this.amount1Out?.toString() ?? null,
    };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: UniswapV3CloseOrderStateJSON): UniswapV3CloseOrderState {
    return new UniswapV3CloseOrderState({
      registrationTxHash: json.registrationTxHash,
      registeredAt: json.registeredAt ? new Date(json.registeredAt) : null,
      triggeredAt: json.triggeredAt ? new Date(json.triggeredAt) : null,
      triggerSqrtPriceX96: json.triggerSqrtPriceX96 ? BigInt(json.triggerSqrtPriceX96) : null,
      executionTxHash: json.executionTxHash,
      executedAt: json.executedAt ? new Date(json.executedAt) : null,
      executionFeeBps: json.executionFeeBps,
      executionError: json.executionError,
      retryCount: json.retryCount,
      amount0Out: json.amount0Out ? BigInt(json.amount0Out) : null,
      amount1Out: json.amount1Out ? BigInt(json.amount1Out) : null,
    });
  }
}
