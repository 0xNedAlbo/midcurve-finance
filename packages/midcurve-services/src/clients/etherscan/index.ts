/**
 * Etherscan Client Exports
 */

export {
  EtherscanClient,
  EtherscanApiError,
  EtherscanApiKeyMissingError,
  EVENT_SIGNATURES,
  NFT_POSITION_MANAGER_ADDRESSES,
  SUPPORTED_CHAIN_IDS,
  type EtherscanClientDependencies,
} from './etherscan-client.js';

export type {
  EtherscanLog,
  EtherscanLogsResponse,
  EtherscanBlockNumberResponse,
  EtherscanContractCreationResponse,
  ContractCreationInfo,
  FetchLogsOptions,
  FetchPositionEventsOptions,
  RawPositionEvent,
  UniswapV3EventType,
} from './types.js';
