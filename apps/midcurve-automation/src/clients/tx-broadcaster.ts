/**
 * Transaction Broadcaster
 *
 * Handles broadcasting signed transactions and waiting for confirmations.
 */

import { broadcastTransaction, waitForTransaction } from '../lib/evm';
import { automationLogger, autoLog } from '../lib/logger';
import type { SupportedChainId } from '../lib/config';

const log = automationLogger.child({ component: 'TxBroadcaster' });

// =============================================================================
// Types
// =============================================================================

export interface BroadcastResult {
  txHash: `0x${string}`;
  chainId: number;
}

export interface ConfirmationResult {
  txHash: `0x${string}`;
  chainId: number;
  blockNumber: bigint;
  gasUsed: bigint;
  status: 'success' | 'reverted';
}

// =============================================================================
// Broadcaster
// =============================================================================

class TxBroadcaster {
  /**
   * Broadcast a signed transaction
   */
  async broadcast(
    chainId: SupportedChainId,
    signedTx: `0x${string}`,
    operation: string
  ): Promise<BroadcastResult> {
    autoLog.methodEntry(log, 'broadcast');

    try {
      const txHash = await broadcastTransaction(chainId, signedTx);

      autoLog.txBroadcast(log, chainId, txHash, operation);

      return {
        txHash,
        chainId,
      };
    } catch (err) {
      autoLog.methodError(log, 'broadcast', err, { chainId, operation });
      throw err;
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(
    chainId: SupportedChainId,
    txHash: `0x${string}`,
    confirmations = 1
  ): Promise<ConfirmationResult> {
    autoLog.methodEntry(log, 'waitForConfirmation');

    try {
      const result = await waitForTransaction(chainId, txHash, confirmations);

      autoLog.txConfirmed(
        log,
        chainId,
        txHash,
        Number(result.blockNumber),
        result.gasUsed.toString()
      );

      return {
        txHash,
        chainId,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
        status: result.status,
      };
    } catch (err) {
      autoLog.methodError(log, 'waitForConfirmation', err, { chainId, txHash });
      throw err;
    }
  }

  /**
   * Broadcast and wait for confirmation in one call
   */
  async broadcastAndWait(
    chainId: SupportedChainId,
    signedTx: `0x${string}`,
    operation: string,
    confirmations = 1
  ): Promise<ConfirmationResult> {
    const broadcast = await this.broadcast(chainId, signedTx, operation);
    return this.waitForConfirmation(chainId, broadcast.txHash, confirmations);
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _txBroadcaster: TxBroadcaster | null = null;

export function getTxBroadcaster(): TxBroadcaster {
  if (!_txBroadcaster) {
    _txBroadcaster = new TxBroadcaster();
  }
  return _txBroadcaster;
}

export { TxBroadcaster };
