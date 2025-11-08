/**
 * Etherscan API Type Definitions
 *
 * Types for the Etherscan v2 unified API that works across all supported chains.
 * The v2 API uses a single endpoint and API key for Ethereum, Arbitrum, Base, Optimism, and Polygon.
 */

/**
 * Raw event log structure from Etherscan API
 */
export interface EtherscanLog {
  /** Contract address that emitted the event */
  address: string;
  /** Event topics (indexed parameters) - topic[0] is event signature */
  topics: string[];
  /** Non-indexed event data (hex string) */
  data: string;
  /** Block number (decimal string) */
  blockNumber: string;
  /** Block hash */
  blockHash: string;
  /** Block timestamp (Unix timestamp in seconds, as string) */
  timeStamp: string;
  /** Gas price for the transaction */
  gasPrice: string;
  /** Gas used by the transaction */
  gasUsed: string;
  /** Log index within the block */
  logIndex: string;
  /** Transaction hash */
  transactionHash: string;
  /** Transaction index within the block */
  transactionIndex: string;
}

/**
 * Generic Etherscan API response for log queries
 */
export interface EtherscanLogsResponse {
  /** Status code: "1" for success, "0" for error */
  status: string;
  /** Status message */
  message: string;
  /** Array of logs on success, error string on failure */
  result: EtherscanLog[] | string;
}

/**
 * Response for block number lookup by timestamp
 */
export interface EtherscanBlockNumberResponse {
  /** Status code: "1" for success, "0" for error */
  status: string;
  /** Status message */
  message: string;
  /** Block number as decimal string */
  result: string;
}

/**
 * Contract creation information
 */
export interface ContractCreationInfo {
  /** Contract address */
  contractAddress: string;
  /** Creator address */
  contractCreator: string;
  /** Creation transaction hash */
  txHash: string;
  /** Block number where contract was created */
  blockNumber: string;
}

/**
 * Response for contract creation lookup
 */
export interface EtherscanContractCreationResponse {
  /** Status code: "1" for success, "0" for error */
  status: string;
  /** Status message */
  message: string;
  /** Array of contract creation info, or error string */
  result: ContractCreationInfo[] | string;
}

/**
 * Options for fetching logs
 */
export interface FetchLogsOptions {
  /** Starting block number (default: "earliest") */
  fromBlock?: string | number;
  /** Ending block number (default: "latest") */
  toBlock?: string | number;
  /** Event signature filter (topic[0]) */
  topic0?: string;
  /** First indexed parameter filter (topic[1]) */
  topic1?: string;
  /** Second indexed parameter filter (topic[2]) */
  topic2?: string;
  /** Third indexed parameter filter (topic[3]) */
  topic3?: string;
}

/**
 * Uniswap V3 event type
 */
export type UniswapV3EventType = 'INCREASE_LIQUIDITY' | 'DECREASE_LIQUIDITY' | 'COLLECT';

/**
 * Options for fetching position events
 */
export interface FetchPositionEventsOptions {
  /** Starting block number (default: NFPM deployment block) */
  fromBlock?: string | number;
  /** Ending block number (default: "latest") */
  toBlock?: string | number;
  /** Event types to fetch (default: all three types) */
  eventTypes?: UniswapV3EventType[];
}

/**
 * Parsed position event from Uniswap V3 NFT Position Manager
 *
 * This is the output format after parsing raw Etherscan logs.
 * All amounts are returned as decimal strings to preserve precision.
 */
export interface RawPositionEvent {
  /** Event type */
  eventType: UniswapV3EventType;
  /** NFT token ID (decimal string) */
  tokenId: string;
  /** Transaction hash */
  transactionHash: string;
  /** Block number */
  blockNumber: bigint;
  /** Transaction index within block */
  transactionIndex: number;
  /** Log index within transaction */
  logIndex: number;
  /** Block timestamp */
  blockTimestamp: Date;
  /** Chain ID where event occurred */
  chainId: number;

  // Event-specific fields (optional - depends on eventType)

  /** Liquidity delta (INCREASE_LIQUIDITY, DECREASE_LIQUIDITY only) */
  liquidity?: string;
  /** Token0 amount */
  amount0?: string;
  /** Token1 amount */
  amount1?: string;
  /** Recipient address (COLLECT only) */
  recipient?: string;
}
