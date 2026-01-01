/**
 * UniswapV3 Contract State
 *
 * Mutable state for a UniswapV3 automation contract.
 * Tracks deployment status and close ID counter.
 */

/**
 * UniswapV3 Contract State Data
 *
 * Mutable state updated during contract lifecycle.
 */
export interface UniswapV3ContractStateData {
  /**
   * Transaction hash of deployment transaction
   */
  deploymentTxHash: string | null;

  /**
   * Timestamp when contract was deployed on-chain
   */
  deployedAt: Date | null;

  /**
   * Last used close ID (for incrementing new close orders)
   */
  lastCloseId: number;
}

/**
 * JSON-serializable representation of state
 */
export interface UniswapV3ContractStateJSON {
  deploymentTxHash: string | null;
  deployedAt: string | null;
  lastCloseId: number;
}

/**
 * UniswapV3 Contract State Class
 *
 * Provides serialization and deserialization methods.
 */
export class UniswapV3ContractState implements UniswapV3ContractStateData {
  readonly deploymentTxHash: string | null;
  readonly deployedAt: Date | null;
  readonly lastCloseId: number;

  constructor(data: Partial<UniswapV3ContractStateData>) {
    this.deploymentTxHash = data.deploymentTxHash ?? null;
    this.deployedAt = data.deployedAt ?? null;
    this.lastCloseId = data.lastCloseId ?? 0;
  }

  /**
   * Create an empty state with default values
   */
  static empty(): UniswapV3ContractState {
    return new UniswapV3ContractState({});
  }

  /**
   * Serialize to JSON-safe object
   */
  toJSON(): UniswapV3ContractStateJSON {
    return {
      deploymentTxHash: this.deploymentTxHash,
      deployedAt: this.deployedAt?.toISOString() ?? null,
      lastCloseId: this.lastCloseId,
    };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: UniswapV3ContractStateJSON): UniswapV3ContractState {
    return new UniswapV3ContractState({
      deploymentTxHash: json.deploymentTxHash,
      deployedAt: json.deployedAt ? new Date(json.deployedAt) : null,
      lastCloseId: json.lastCloseId,
    });
  }

  /**
   * Check if contract is deployed
   */
  isDeployed(): boolean {
    return this.deployedAt !== null;
  }

  /**
   * Get the next close ID
   */
  getNextCloseId(): number {
    return this.lastCloseId + 1;
  }
}
