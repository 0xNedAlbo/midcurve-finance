/**
 * Close Order Receipt Publisher
 *
 * Extracts close order lifecycle events from a transaction receipt
 * and publishes them to the close-order-events RabbitMQ exchange.
 *
 * Used by:
 * - API: When user submits a tx hash after registering/cancelling/modifying orders
 * - Automation: After executor successfully executes an order
 */

import type { Channel } from 'amqplib';
import { EvmConfig } from '../config/index.js';
import { createServiceLogger } from '../logging/index.js';
import {
  buildCloseOrderEvent,
  buildCloseOrderRoutingKey,
  serializeCloseOrderEvent,
  EXCHANGE_CLOSE_ORDER_EVENTS,
  type RawEventLog,
} from './close-order-event-decoder.js';

const logger = createServiceLogger('CloseOrderReceiptPublisher');

export interface PublishCloseOrderEventsResult {
  eventsPublished: number;
}

/**
 * Extract close order events from a transaction receipt and publish them
 * to the close-order-events exchange.
 *
 * @param channel - RabbitMQ channel for publishing
 * @param chainId - Chain ID where the transaction was executed
 * @param txHash - Transaction hash to extract events from
 * @param contractAddress - Address of the UniswapV3PositionCloser contract
 * @returns Number of events published
 */
export async function publishCloseOrderEventsFromReceipt(
  channel: Channel,
  chainId: number,
  txHash: `0x${string}`,
  contractAddress: string,
): Promise<PublishCloseOrderEventsResult> {
  const evmConfig = EvmConfig.getInstance();
  const client = evmConfig.getPublicClient(chainId);

  const receipt = await client.getTransactionReceipt({ hash: txHash });

  if (receipt.status === 'reverted') {
    throw new Error(`Transaction ${txHash} reverted`);
  }

  // Filter logs from the closer contract
  const contractLogs = receipt.logs.filter(
    (log) => log.address.toLowerCase() === contractAddress.toLowerCase()
  );

  let eventsPublished = 0;

  for (const log of contractLogs) {
    const rawLog: RawEventLog = {
      address: log.address,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      data: log.data,
      blockNumber: receipt.blockNumber,
      transactionHash: receipt.transactionHash,
      logIndex: log.logIndex,
      removed: log.removed,
    };

    const event = buildCloseOrderEvent(chainId, contractAddress, rawLog);
    if (!event) continue;

    const isVaultEvent = event.vaultAddress !== undefined;
    const routingKey = isVaultEvent
      ? buildCloseOrderRoutingKey(chainId, event.vaultAddress!, event.triggerMode, 'vault')
      : buildCloseOrderRoutingKey(chainId, event.nftId!, event.triggerMode);
    const content = serializeCloseOrderEvent(event);

    channel.publish(EXCHANGE_CLOSE_ORDER_EVENTS, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
    });

    eventsPublished++;

    logger.info({
      chainId,
      txHash,
      eventType: event.type,
      nftId: event.nftId ?? event.vaultAddress,
      triggerMode: event.triggerMode,
      routingKey,
      msg: 'Published close order event from receipt',
    });
  }

  return { eventsPublished };
}
