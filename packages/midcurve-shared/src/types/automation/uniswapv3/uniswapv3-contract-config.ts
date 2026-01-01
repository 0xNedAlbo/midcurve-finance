/**
 * UniswapV3 Contract Config
 *
 * Immutable configuration for a UniswapV3 automation contract.
 * Contains deployment addresses and chain information.
 */

/**
 * UniswapV3 Contract Config Data
 *
 * Immutable configuration set at contract deployment.
 */
export interface UniswapV3ContractConfigData {
  /**
   * Chain ID where contract is deployed
   */
  chainId: number;

  /**
   * Deployed contract address (EIP-55 checksummed)
   */
  contractAddress: string;

  /**
   * NonFungiblePositionManager address on this chain
   */
  nfpmAddress: string;

  /**
   * Operator address (automation service wallet)
   */
  operatorAddress: string;
}

/**
 * JSON-serializable representation of config
 */
export interface UniswapV3ContractConfigJSON {
  chainId: number;
  contractAddress: string;
  nfpmAddress: string;
  operatorAddress: string;
}

/**
 * UniswapV3 Contract Config Class
 *
 * Provides serialization and deserialization methods.
 */
export class UniswapV3ContractConfig implements UniswapV3ContractConfigData {
  readonly chainId: number;
  readonly contractAddress: string;
  readonly nfpmAddress: string;
  readonly operatorAddress: string;

  constructor(data: UniswapV3ContractConfigData) {
    this.chainId = data.chainId;
    this.contractAddress = data.contractAddress;
    this.nfpmAddress = data.nfpmAddress;
    this.operatorAddress = data.operatorAddress;
  }

  /**
   * Serialize to JSON-safe object
   */
  toJSON(): UniswapV3ContractConfigJSON {
    return {
      chainId: this.chainId,
      contractAddress: this.contractAddress,
      nfpmAddress: this.nfpmAddress,
      operatorAddress: this.operatorAddress,
    };
  }

  /**
   * Create from JSON representation
   */
  static fromJSON(json: UniswapV3ContractConfigJSON): UniswapV3ContractConfig {
    return new UniswapV3ContractConfig({
      chainId: json.chainId,
      contractAddress: json.contractAddress,
      nfpmAddress: json.nfpmAddress,
      operatorAddress: json.operatorAddress,
    });
  }
}
