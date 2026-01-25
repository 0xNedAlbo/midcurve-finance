// ============================================================================
// EVM Smart Contract Config
// ============================================================================

/**
 * Configuration data for EVM smart contracts
 * Stored in the config JSON field
 */
export interface EvmSmartContractConfigData {
  /** EVM chain ID (e.g., 1 for Ethereum, 42161 for Arbitrum) */
  chainId: number;
  /** Contract address (EIP-55 checksummed) */
  address: string;
}

/**
 * JSON representation (same structure, addresses are strings)
 */
export interface EvmSmartContractConfigJSON {
  chainId: number;
  address: string;
}

/**
 * EVM Smart Contract Config class with serialization
 */
export class EvmSmartContractConfig {
  readonly chainId: number;
  readonly address: string;

  constructor(data: EvmSmartContractConfigData) {
    this.chainId = data.chainId;
    this.address = data.address;
  }

  /**
   * Serialize to JSON-compatible format
   */
  toJSON(): EvmSmartContractConfigJSON {
    return {
      chainId: this.chainId,
      address: this.address,
    };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: EvmSmartContractConfigJSON): EvmSmartContractConfig {
    return new EvmSmartContractConfig({
      chainId: json.chainId,
      address: json.address,
    });
  }

  /**
   * Create from database record config field
   */
  static fromRecord(config: unknown): EvmSmartContractConfig {
    const json = config as EvmSmartContractConfigJSON;
    return EvmSmartContractConfig.fromJSON(json);
  }
}
