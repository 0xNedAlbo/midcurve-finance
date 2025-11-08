/**
 * EVM Block Information
 *
 * Represents block data retrieved from EVM-compatible chains.
 * All numeric values are bigint to preserve precision.
 */
export interface EvmBlockInfo {
  /** Block hash (0x-prefixed hex string) */
  hash: string;

  /** Block number */
  number: bigint;

  /** Block timestamp (Unix seconds) */
  timestamp: bigint;

  /** Total gas used in the block */
  gasUsed: bigint;

  /** Maximum gas allowed in the block */
  gasLimit: bigint;

  /** Base fee per gas (EIP-1559), null for pre-London blocks */
  baseFeePerGas: bigint | null;

  /** Number of transactions in the block */
  transactionCount: number;

  /** Parent block hash (0x-prefixed hex string) */
  parentHash: string;

  /** Optional block tag used to retrieve this block (e.g., "finalized", "latest") */
  blockTag?: string;
}
