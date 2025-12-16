/**
 * Loop Registry
 *
 * In-memory registry for managing StrategyLoop instances.
 * Provides lifecycle management for strategy execution loops.
 *
 * This registry is specific to a single EVM Core instance.
 * For horizontal scaling, each instance maintains its own registry
 * and strategies are distributed via external coordination.
 */

import type { Address } from 'viem';
import type { StrategyLoop } from '../orchestrator/strategy-loop';
import { logger, evmLog } from '../../../lib/logger';

// =============================================================================
// Types
// =============================================================================

/**
 * Loop status
 */
export type LoopStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

/**
 * Loop entry in the registry
 */
export interface LoopEntry {
  strategyId: string;
  contractAddress: Address;
  loop: StrategyLoop;
  status: LoopStatus;
  startedAt: Date;
  stoppedAt?: Date;
  error?: string;
}

/**
 * Summary info for a registered loop
 */
export interface LoopInfo {
  strategyId: string;
  contractAddress: Address;
  status: LoopStatus;
  startedAt: Date;
  stoppedAt?: Date;
  error?: string;
}

// =============================================================================
// Registry
// =============================================================================

class LoopRegistry {
  private readonly log = logger.child({ registry: 'LoopRegistry' });
  private readonly loops = new Map<Address, LoopEntry>();

  /**
   * Register a new strategy loop
   *
   * @param strategyId - Strategy ID
   * @param contractAddress - Contract address (key for lookup)
   * @param loop - StrategyLoop instance
   * @throws If a loop is already registered for this address
   */
  register(
    strategyId: string,
    contractAddress: Address,
    loop: StrategyLoop
  ): void {
    evmLog.methodEntry(this.log, 'register', { strategyId, contractAddress });

    const normalizedAddress = contractAddress.toLowerCase() as Address;

    if (this.loops.has(normalizedAddress)) {
      throw new Error(
        `Loop already registered for contract ${contractAddress}`
      );
    }

    const entry: LoopEntry = {
      strategyId,
      contractAddress: normalizedAddress,
      loop,
      status: 'starting',
      startedAt: new Date(),
    };

    this.loops.set(normalizedAddress, entry);

    this.log.info({
      strategyId,
      contractAddress,
      msg: 'Loop registered',
    });

    evmLog.methodExit(this.log, 'register');
  }

  /**
   * Update loop status
   *
   * @param contractAddress - Contract address
   * @param status - New status
   * @param error - Optional error message (for 'error' status)
   */
  updateStatus(
    contractAddress: Address,
    status: LoopStatus,
    error?: string
  ): void {
    const normalizedAddress = contractAddress.toLowerCase() as Address;
    const entry = this.loops.get(normalizedAddress);

    if (!entry) {
      this.log.warn({
        contractAddress,
        status,
        msg: 'Cannot update status: loop not found',
      });
      return;
    }

    entry.status = status;
    if (error) {
      entry.error = error;
    }
    if (status === 'stopped') {
      entry.stoppedAt = new Date();
    }

    this.log.info({
      strategyId: entry.strategyId,
      contractAddress,
      status,
      msg: 'Loop status updated',
    });
  }

  /**
   * Get a loop by contract address
   *
   * @param contractAddress - Contract address
   * @returns Loop entry or undefined
   */
  get(contractAddress: Address): LoopEntry | undefined {
    const normalizedAddress = contractAddress.toLowerCase() as Address;
    return this.loops.get(normalizedAddress);
  }

  /**
   * Check if a loop is registered
   *
   * @param contractAddress - Contract address
   * @returns True if loop is registered
   */
  has(contractAddress: Address): boolean {
    const normalizedAddress = contractAddress.toLowerCase() as Address;
    return this.loops.has(normalizedAddress);
  }

  /**
   * Unregister a loop
   *
   * @param contractAddress - Contract address
   * @returns True if loop was removed
   */
  unregister(contractAddress: Address): boolean {
    evmLog.methodEntry(this.log, 'unregister', { contractAddress });

    const normalizedAddress = contractAddress.toLowerCase() as Address;
    const entry = this.loops.get(normalizedAddress);

    if (!entry) {
      evmLog.methodExit(this.log, 'unregister', { removed: false });
      return false;
    }

    this.loops.delete(normalizedAddress);

    this.log.info({
      strategyId: entry.strategyId,
      contractAddress,
      msg: 'Loop unregistered',
    });

    evmLog.methodExit(this.log, 'unregister', { removed: true });
    return true;
  }

  /**
   * Get info for all registered loops
   *
   * @returns Array of loop info
   */
  list(): LoopInfo[] {
    return Array.from(this.loops.values()).map((entry) => ({
      strategyId: entry.strategyId,
      contractAddress: entry.contractAddress,
      status: entry.status,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt,
      error: entry.error,
    }));
  }

  /**
   * Get count of registered loops
   */
  get size(): number {
    return this.loops.size;
  }

  /**
   * Get count of running loops
   */
  get runningCount(): number {
    return Array.from(this.loops.values()).filter(
      (entry) => entry.status === 'running'
    ).length;
  }

  /**
   * Stop all loops gracefully
   *
   * @param timeoutMs - Maximum time to wait for each loop to stop
   */
  async stopAll(timeoutMs: number = 30000): Promise<void> {
    evmLog.methodEntry(this.log, 'stopAll', { loopCount: this.loops.size });

    const stopPromises = Array.from(this.loops.entries()).map(
      async ([address, entry]) => {
        try {
          this.updateStatus(address, 'stopping');
          await Promise.race([
            entry.loop.stop(),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Stop timeout')),
                timeoutMs
              )
            ),
          ]);
          this.updateStatus(address, 'stopped');
        } catch (error) {
          this.updateStatus(
            address,
            'error',
            error instanceof Error ? error.message : 'Unknown error'
          );
          this.log.error({
            strategyId: entry.strategyId,
            contractAddress: address,
            error,
            msg: 'Failed to stop loop',
          });
        }
      }
    );

    await Promise.all(stopPromises);

    evmLog.methodExit(this.log, 'stopAll');
  }

  /**
   * Clear all entries (use with caution - loops should be stopped first)
   */
  clear(): void {
    this.log.warn({ msg: 'Clearing all loop entries' });
    this.loops.clear();
  }
}

// =============================================================================
// Singleton
// =============================================================================

let loopRegistryInstance: LoopRegistry | null = null;

/**
 * Get the singleton loop registry instance
 */
export function getLoopRegistry(): LoopRegistry {
  if (!loopRegistryInstance) {
    loopRegistryInstance = new LoopRegistry();
  }
  return loopRegistryInstance;
}

export { LoopRegistry };
