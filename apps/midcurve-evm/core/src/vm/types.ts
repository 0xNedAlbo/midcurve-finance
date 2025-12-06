import type { Address, Hex, Log } from 'viem';

/**
 * Configuration for VmRunner
 */
export interface VmRunnerConfig {
  /** HTTP RPC URL for the Geth node */
  rpcUrl?: string;
  /** WebSocket URL for the Geth node */
  wsUrl?: string;
}

/**
 * Result of a contract call
 */
export interface CallResult {
  /** Whether the transaction succeeded */
  success: boolean;
  /** Gas used by the transaction */
  gasUsed: bigint;
  /** Logs emitted by the transaction */
  logs: Log[];
  /** Error message if the transaction failed */
  error?: string;
  /** Transaction hash */
  txHash?: Hex;
}

/**
 * Result of a contract deployment
 */
export interface DeployResult {
  /** Deployed contract address */
  address: Address;
  /** Gas used for deployment */
  gasUsed: bigint;
  /** Transaction hash */
  txHash: Hex;
}

/**
 * Store addresses retrieved from SystemRegistry
 */
export interface StoreAddresses {
  poolStore: Address;
  positionStore: Address;
  balanceStore: Address;
}
