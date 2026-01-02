/**
 * RabbitMQ Message Types
 *
 * Defines the message structures for order trigger events.
 */

/**
 * Order trigger message - published when price condition is met
 */
export interface OrderTriggerMessage {
  /** Order ID from database */
  orderId: string;
  /** Position ID being closed */
  positionId: string;
  /** Pool address where trigger occurred */
  poolAddress: string;
  /** Chain ID */
  chainId: number;
  /** Current sqrtPriceX96 at trigger time */
  currentPrice: string;
  /** Trigger price boundary that was crossed */
  triggerPrice: string;
  /** Whether this was a lower or upper trigger */
  triggerSide: 'lower' | 'upper';
  /** Timestamp of trigger detection */
  triggeredAt: string;
}

/**
 * Contract deployment message - published when contract needs deployment
 */
export interface ContractDeployMessage {
  /** Contract ID from database */
  contractId: string;
  /** User ID who owns the contract */
  userId: string;
  /** Chain ID for deployment */
  chainId: number;
  /** Contract type (e.g., 'uniswapv3') */
  contractType: string;
  /** Timestamp of request */
  requestedAt: string;
}

/**
 * Serialize a message for publishing
 */
export function serializeMessage<T>(message: T): Buffer {
  return Buffer.from(JSON.stringify(message));
}

/**
 * Deserialize a message from consumption
 */
export function deserializeMessage<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString()) as T;
}
