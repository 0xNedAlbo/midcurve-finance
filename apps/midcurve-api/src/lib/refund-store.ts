/**
 * In-memory store for refund operations
 *
 * This is a simple store for tracking refund operation status.
 * In production, this should be replaced with database storage.
 *
 * Note: Data is lost on server restart.
 */

export interface RefundOperation {
  requestId: string;
  chainId: number;
  amount: string;
  toAddress: string;
  operationStatus: 'pending' | 'signing' | 'broadcasting' | 'completed' | 'failed';
  txHash?: string;
  operationError?: string;
  createdAt: Date;
}

// Simple in-memory store (not persisted across restarts)
const refundOperations = new Map<string, RefundOperation>();

// Clean up old operations (older than 1 hour)
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const MAX_AGE = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = Date.now();
  for (const [id, op] of refundOperations.entries()) {
    if (now - op.createdAt.getTime() > MAX_AGE) {
      refundOperations.delete(id);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Store a refund operation
 */
export function storeRefundOperation(operation: RefundOperation): void {
  refundOperations.set(operation.requestId, operation);
}

/**
 * Get a refund operation by ID
 */
export function getRefundOperation(requestId: string): RefundOperation | undefined {
  return refundOperations.get(requestId);
}

/**
 * Update a refund operation
 */
export function updateRefundOperation(
  requestId: string,
  updates: Partial<RefundOperation>
): void {
  const existing = refundOperations.get(requestId);
  if (existing) {
    refundOperations.set(requestId, { ...existing, ...updates });
  }
}
