/**
 * Queue Depth Probe
 *
 * Reads `messageCount` for a set of queues over AMQP. No management plugin
 * involved — `checkQueue` returns the depth directly.
 *
 * The whole reason this is a module rather than three lines at a call site is
 * that the obvious implementation can stop message processing, and does so
 * exactly when a health check is most likely to run.
 *
 * `Args.checkQueue` sets `passive: true` (amqplib 0.10.9,
 * `lib/api_args.js:77-83`), so probing a queue that does not exist is a server
 * channel exception, not an empty result. Two consequences, both handled here:
 *
 *  1. **The channel dies.** `lib/channel.js:313-331` rejects the pending reply
 *     with a `code: 404` error and then moves the channel to closed. A probe
 *     that borrows a channel carrying consumers therefore cancels those
 *     consumers. A missing queue is the normal state of a fresh broker before
 *     every service has started once, so this is not an exotic path — it is the
 *     first-boot path. Callers pass a factory, and every queue gets a channel of
 *     its own.
 *
 *  2. **The channel emits `'error'`.** Same code path, `channel.js:328`. An
 *     `'error'` event with no listener is an uncaught exception in Node, which
 *     takes the process down — strictly worse than the dead channel this module
 *     exists to avoid. Every probe channel gets a listener before it is used.
 *
 * One channel per queue, not one per call. A 404 on the first queue closes the
 * channel, and every later `checkQueue` on it would reject with "Channel
 * closed" — reporting queues that exist as absent. That is the failure mode
 * that looks like a working probe.
 */

import type { Channel } from 'amqplib';

/**
 * Depth of one queue. `messages: null` means the queue does not exist.
 *
 * Deliberately not an error and deliberately not a health signal: telling
 * "absent" from "empty" needs a notion of which queues are expected to exist,
 * and this module has none. It reports what the broker said.
 */
export interface QueueDepth {
  queue: string;
  messages: number | null;
}

/**
 * Supplies a channel that carries no consumers and may be closed by the probe.
 * Never the caller's shared channel — see the module comment.
 */
export type ProbeChannelFactory = () => Promise<Channel>;

/** AMQP reply code for a passive declare against a queue that does not exist. */
const REPLY_CODE_NOT_FOUND = 404;

/**
 * Read the depth of each queue. Queues are probed one at a time, each on its
 * own channel; order of the result matches the order of `queues`.
 *
 * Throws on anything other than a missing queue — a closed connection or a
 * permission failure is not a depth of zero and must not read as one.
 */
export async function probeQueueDepths(
  createChannel: ProbeChannelFactory,
  queues: readonly string[]
): Promise<QueueDepth[]> {
  const depths: QueueDepth[] = [];

  for (const queue of queues) {
    depths.push({ queue, messages: await probeOne(createChannel, queue) });
  }

  return depths;
}

/**
 * Depth of a single queue, or null if it does not exist.
 */
async function probeOne(
  createChannel: ProbeChannelFactory,
  queue: string
): Promise<number | null> {
  const channel = await createChannel();

  // Both listeners attach before the channel is used. 'error' is the one that
  // would otherwise crash the process; 'close' is what tells the finally block
  // below whether there is still a channel to close.
  let closed = false;
  const markClosed = (): void => {
    closed = true;
  };
  channel.on('error', markClosed);
  channel.on('close', markClosed);

  try {
    const { messageCount } = await channel.checkQueue(queue);
    return messageCount;
  } catch (err) {
    if (isNotFound(err)) {
      return null;
    }
    throw err;
  } finally {
    // On a 404 the server already closed the channel and `close()` would reject
    // with IllegalOperationError. The flag is reliable rather than racy: the
    // server-close path rejects the pending reply and then emits 'error'
    // synchronously, while the `await` above resumes on a microtask — so the
    // listener has always run by the time this block does.
    if (!closed) {
      await channel.close();
    }
  }
}

/**
 * True for the channel exception a passive declare raises against a missing
 * queue. Keyed on the AMQP reply code, not on the message text.
 */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === REPLY_CODE_NOT_FOUND
  );
}
