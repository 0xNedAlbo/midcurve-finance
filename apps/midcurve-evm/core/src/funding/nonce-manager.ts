import {
  type Address,
} from 'viem';
import type pino from 'pino';

/**
 * Interface for a client that can fetch transaction counts.
 * This is a minimal interface to avoid strict viem PublicClient typing issues.
 */
interface TransactionCountClient {
  getTransactionCount: (params: {
    address: Address;
    blockTag: 'pending' | 'latest';
  }) => Promise<number>;
}

/**
 * NonceManager tracks nonces per chain for the automation wallet.
 *
 * Key features:
 * - One nonce sequence per chain (chainId → nonce)
 * - Atomic nonce assignment (JS single-threaded execution ensures no race conditions)
 * - Initialization from network state using 'pending' block tag
 * - Reset capability for recovery after failures
 *
 * Usage:
 * 1. Create NonceManager with chain clients
 * 2. Call initializeChain() for each chain before sending transactions
 * 3. Call getNextNonce() to get and atomically increment nonce
 * 4. Call resetChain() if nonce errors occur
 */
export class NonceManager {
  private nonces: Map<number, bigint> = new Map();
  private initialized: Set<number> = new Set();

  constructor(
    private chainClients: Map<number, { public: TransactionCountClient }>,
    private walletAddress: Address,
    private logger: pino.Logger
  ) {}

  /**
   * Initialize nonce for a chain from network state.
   * Uses 'pending' tag to account for mempool transactions.
   */
  async initializeChain(chainId: number): Promise<void> {
    const client = this.chainClients.get(chainId);
    if (!client) {
      throw new Error(`Chain ${chainId} not configured`);
    }

    const nonce = await client.public.getTransactionCount({
      address: this.walletAddress,
      blockTag: 'pending',
    });

    this.nonces.set(chainId, BigInt(nonce));
    this.initialized.add(chainId);

    this.logger.info({ chainId, nonce }, 'Initialized nonce for chain');
  }

  /**
   * Initialize nonces for all configured chains.
   */
  async initializeAll(): Promise<void> {
    for (const chainId of this.chainClients.keys()) {
      await this.initializeChain(chainId);
    }
  }

  /**
   * Get and increment nonce atomically.
   * Must be called before sending a transaction.
   *
   * @deprecated Use reserveNonce() for safer nonce management.
   * This method increments before returning, so failures leave nonce out of sync.
   *
   * @throws Error if chain nonce is not initialized
   */
  getNextNonce(chainId: number): bigint {
    if (!this.initialized.has(chainId)) {
      throw new Error(`Chain ${chainId} nonce not initialized. Call initializeChain() first.`);
    }

    const current = this.nonces.get(chainId)!;
    this.nonces.set(chainId, current + 1n);

    this.logger.debug({ chainId, nonce: current.toString() }, 'Assigned nonce');
    return current;
  }

  /**
   * Reserve a nonce for use without incrementing.
   * Call commit() after successful transaction submission to increment.
   * Call release() if the transaction fails before submission.
   *
   * This pattern ensures the nonce stays in sync with on-chain state
   * even when transactions fail for non-nonce reasons (network errors,
   * insufficient funds, gas estimation failures, etc.)
   *
   * @throws Error if chain nonce is not initialized
   * @returns Object with nonce value and commit/release callbacks
   */
  reserveNonce(chainId: number): { nonce: bigint; commit: () => void; release: () => void } {
    if (!this.initialized.has(chainId)) {
      throw new Error(`Chain ${chainId} nonce not initialized. Call initializeChain() first.`);
    }

    const current = this.nonces.get(chainId)!;

    this.logger.debug({ chainId, nonce: current.toString() }, 'Reserved nonce');

    return {
      nonce: current,
      commit: () => {
        // Only increment if the nonce matches (wasn't reset in between)
        const currentNonce = this.nonces.get(chainId);
        if (currentNonce === current) {
          this.nonces.set(chainId, current + 1n);
          this.logger.debug({ chainId, nonce: current.toString() }, 'Committed nonce');
        } else {
          this.logger.debug(
            { chainId, reserved: current.toString(), current: currentNonce?.toString() },
            'Nonce was reset, skipping commit'
          );
        }
      },
      release: () => {
        // Nothing to do - nonce was never incremented
        this.logger.debug({ chainId, nonce: current.toString() }, 'Released nonce (not used)');
      },
    };
  }

  /**
   * Reset nonce from network state.
   * Use after transaction failures or suspected desync.
   */
  async resetChain(chainId: number): Promise<void> {
    this.initialized.delete(chainId);
    await this.initializeChain(chainId);
    this.logger.warn({ chainId }, 'Reset nonce for chain');
  }

  /**
   * Get current nonce without incrementing (for debugging/logging).
   */
  peekNonce(chainId: number): bigint | undefined {
    return this.nonces.get(chainId);
  }

  /**
   * Check if a chain has been initialized.
   */
  isInitialized(chainId: number): boolean {
    return this.initialized.has(chainId);
  }

  /**
   * Get all initialized chain IDs.
   */
  getInitializedChains(): number[] {
    return Array.from(this.initialized);
  }
}

/**
 * Check if an error is a nonce-related error that warrants a reset.
 *
 * Common nonce errors:
 * - "nonce too low" - Transaction with this nonce already mined
 * - "nonce too high" - Gap in nonce sequence
 * - "replacement transaction underpriced" - Same nonce, need higher gas
 */
export function isNonceError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('nonce too low') ||
    message.includes('nonce too high') ||
    message.includes('replacement transaction underpriced') ||
    message.includes('already known') ||
    message.includes('nonce has already been used')
  );
}
