/**
 * Dead-Letter Demonstration Script
 *
 * Each success criterion in #82 is a command here rather than a paragraph, so
 * the claims in the PR are reproducible against a local broker. Run with tsx:
 *
 *   pnpm --filter @midcurve/automation exec tsx scripts/dlq-demo.ts <command>
 *
 * Commands:
 *   depths                 depth of all three dead-letter queues (criterion 3)
 *   publish-poison         publish a trigger the executor cannot deserialize
 *                          (criteria 1 and 2)
 *   force-dead-letter <n>  push one message into one DLQ: orders | domain | close-order
 *   probe-hazard           criterion 6's mutation check — the same probe run
 *                          both ways, showing which one kills a consumer
 *
 * This script talks to the broker directly. It needs no database, signer, or
 * chain, which is what lets the topology claims be checked on their own.
 */

import amqplib, { type ChannelModel, type Channel } from 'amqplib';
import {
  probeQueueDepths,
  DOMAIN_QUEUES,
  DOMAIN_EVENTS_DLX,
  EXCHANGE_CLOSE_ORDER_EVENTS_DLX,
  QUEUE_CLOSE_ORDER_EVENTS_DLQ,
} from '@midcurve/services';
import { getRabbitMQConfig } from '../src/lib/config';
import { EXCHANGES, QUEUES, ROUTING_KEYS } from '../src/mq/topology';

const DEAD_LETTER_QUEUES = [
  QUEUES.ORDERS_DLQ,
  DOMAIN_QUEUES.DLQ,
  QUEUE_CLOSE_ORDER_EVENTS_DLQ,
];

const DLX_BY_ALIAS: Record<string, string> = {
  orders: EXCHANGES.ORDERS_DLX,
  domain: DOMAIN_EVENTS_DLX,
  'close-order': EXCHANGE_CLOSE_ORDER_EVENTS_DLX,
};

/** A queue name nothing declares, so a passive declare against it is a 404. */
const ABSENT_QUEUE = 'demo.queue.that.does.not.exist';

function connectionUrl(): string {
  const config = getRabbitMQConfig();
  const vhost = config.vhost ? `/${config.vhost}` : '';
  return `amqp://${encodeURIComponent(config.username)}:${encodeURIComponent(
    config.password
  )}@${config.host}:${config.port}${vhost}`;
}

// =============================================================================
// Commands
// =============================================================================

/** Criterion 3 — the three depths, read over AMQP. */
async function depths(connection: ChannelModel): Promise<void> {
  const results = await probeQueueDepths(
    () => connection.createChannel(),
    DEAD_LETTER_QUEUES
  );

  for (const { queue, messages } of results) {
    console.log(`${messages === null ? 'absent'.padStart(6) : String(messages).padStart(6)}  ${queue}`);
  }
}

/**
 * Criteria 1 and 2 — a trigger the executor cannot deserialize.
 *
 * It must be malformed bytes. deserializeMessage() is a bare JSON.parse with no
 * schema validation (src/mq/messages.ts), so a well-formed JSON object with the
 * wrong fields parses cleanly and then fails downstream in executeOrder(), which
 * goes to the retry state machine and acks. Only invalid JSON reaches the nack
 * that this issue is about.
 */
async function publishPoison(connection: ChannelModel): Promise<void> {
  const channel = await connection.createChannel();

  const published = channel.publish(
    EXCHANGES.TRIGGERS,
    ROUTING_KEYS.ORDER_TRIGGERED,
    Buffer.from('not-json'),
    { persistent: true, contentType: 'application/json' }
  );

  await channel.close();

  console.log(
    `published ${published ? 'ok' : 'FAILED'}: 'not-json' -> ${EXCHANGES.TRIGGERS}/${ROUTING_KEYS.ORDER_TRIGGERED}`
  );
  console.log(`the executor consuming ${QUEUES.ORDERS_PENDING} will nack it with requeue=false`);
}

/** Criterion 3 — force one message into a chosen DLQ via its dead-letter exchange. */
async function forceDeadLetter(connection: ChannelModel, alias: string): Promise<void> {
  const exchange = DLX_BY_ALIAS[alias];
  if (!exchange) {
    throw new Error(
      `Unknown DLQ alias '${alias}'. Expected one of: ${Object.keys(DLX_BY_ALIAS).join(', ')}`
    );
  }

  const channel = await connection.createChannel();
  const body = JSON.stringify({ demo: true, alias, note: 'issue-82 criterion 3' });

  const published = channel.publish(exchange, '', Buffer.from(body), {
    persistent: true,
    contentType: 'application/json',
  });

  await channel.close();
  console.log(`published ${published ? 'ok' : 'FAILED'} -> ${exchange} (fanout)`);
}

/**
 * Criterion 6 — the mutation check.
 *
 * Both halves probe the same absent queue. The only difference is which channel
 * carries the passive declare. If both survive, the test is not exercising the
 * hazard and does not count.
 */
async function probeHazard(connection: ChannelModel): Promise<void> {
  console.log('--- arrangement A: probe on a channel that carries a consumer ---');
  const a = await consumerFixture(connection, 'demo.probe.hazard.a');
  try {
    await a.channel.checkQueue(ABSENT_QUEUE);
    console.log('  checkQueue unexpectedly succeeded');
  } catch (err) {
    console.log(`  checkQueue threw: code=${(err as { code?: number }).code}`);
  }
  console.log(`  consumer still delivering: ${await a.stillDelivers()}`);
  await a.cleanup();

  console.log('--- arrangement B: probe on channels of its own ---');
  const b = await consumerFixture(connection, 'demo.probe.hazard.b');
  const results = await probeQueueDepths(() => connection.createChannel(), [
    ABSENT_QUEUE,
    b.queue,
  ]);
  console.log(`  probe results: ${JSON.stringify(results)}`);
  console.log(`  consumer still delivering: ${await b.stillDelivers()}`);
  await b.cleanup();

  console.log('');
  console.log('A must read false and B must read true. Both true means the');
  console.log('demonstration is not exercising the hazard.');
}

/**
 * A throwaway queue with a live consumer on its own channel, plus a way to ask
 * whether that consumer is still being delivered to.
 */
async function consumerFixture(
  connection: ChannelModel,
  queue: string
): Promise<{
  queue: string;
  channel: Channel;
  stillDelivers: () => Promise<boolean>;
  cleanup: () => Promise<void>;
}> {
  const channel = await connection.createChannel();
  // Without this the 404 below is an unhandled 'error' event, which ends the
  // process before the demonstration can report anything.
  channel.on('error', () => undefined);

  await channel.assertQueue(queue, { durable: false, autoDelete: true });

  let delivered = 0;
  await channel.consume(queue, (msg) => {
    if (msg) {
      delivered++;
      channel.ack(msg);
    }
  });

  return {
    queue,
    channel,
    stillDelivers: async () => {
      const before = delivered;
      // A dead channel cannot publish either; route through one that is alive so
      // the only thing under test is whether the consumer receives.
      const publisher = await connection.createChannel();
      publisher.sendToQueue(queue, Buffer.from('ping'));
      await publisher.close();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return delivered > before;
    },
    cleanup: async () => {
      const cleaner = await connection.createChannel();
      await cleaner.deleteQueue(queue);
      await cleaner.close();
      try {
        await channel.close();
      } catch {
        // Already closed by the server in arrangement A — that is the finding,
        // not an error to report here.
      }
    },
  };
}

// =============================================================================
// Entry point
// =============================================================================

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  const connection = await amqplib.connect(connectionUrl());

  try {
    switch (command) {
      case 'depths':
        await depths(connection);
        break;
      case 'publish-poison':
        await publishPoison(connection);
        break;
      case 'force-dead-letter':
        await forceDeadLetter(connection, argument ?? '');
        break;
      case 'probe-hazard':
        await probeHazard(connection);
        break;
      default:
        throw new Error(
          `Unknown command '${command ?? ''}'. Expected: depths | publish-poison | force-dead-letter <name> | probe-hazard`
        );
    }
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
