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
 *
 * Every probe is also bounded in time. A broker that is connected but no longer
 * answering leaves the passive declare unsettled until the heartbeat gives up,
 * which on a request path reads as a hung service rather than a slow one.
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

/** Options for {@link probeQueueDepths}. */
export interface ProbeOptions {
  /**
   * Budget for one passive declare. The whole probe is bounded by
   * `queues.length * timeoutMs`.
   *
   * A connected broker that stops answering leaves `checkQueue` unsettled until
   * the AMQP heartbeat gives up, which is far longer than a caller on a request
   * path can wait. Unbounded, that turns a slow broker into a hung endpoint.
   */
  timeoutMs?: number;
}

/** AMQP reply code for a passive declare against a queue that does not exist. */
const REPLY_CODE_NOT_FOUND = 404;

/** Default per-queue budget. Well under any sane liveness-probe interval. */
const DEFAULT_TIMEOUT_MS = 2000;

/** Thrown when a passive declare does not settle within its budget. */
export class QueueProbeTimeoutError extends Error {
  constructor(
    readonly queue: string,
    readonly timeoutMs: number
  ) {
    super(`Timed out after ${timeoutMs}ms probing queue '${queue}'`);
    this.name = 'QueueProbeTimeoutError';
  }
}

/**
 * Read the depth of each queue. Queues are probed one at a time, each on its
 * own channel; order of the result matches the order of `queues`.
 *
 * Throws on anything other than a missing queue — a closed connection, a
 * permission failure, or a broker that stopped answering is not a depth of zero
 * and must not read as one. Callers on a request path are expected to catch and
 * decide; see the health route.
 */
export async function probeQueueDepths(
  createChannel: ProbeChannelFactory,
  queues: readonly string[],
  options: ProbeOptions = {}
): Promise<QueueDepth[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const depths: QueueDepth[] = [];

  for (const queue of queues) {
    depths.push({ queue, messages: await probeOne(createChannel, queue, timeoutMs) });
  }

  return depths;
}

/**
 * Depth of a single queue, or null if it does not exist.
 */
async function probeOne(
  createChannel: ProbeChannelFactory,
  queue: string,
  timeoutMs: number
): Promise<number | null> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: Channel | undefined;
  let closed = false;

  // The budget covers opening the channel as well as the declare. Opening one
  // is itself a round trip (channel.open / channel.open-ok), so a broker that
  // has stopped answering hangs here first — before there is any declare to put
  // a timeout around. Racing only the declare would leave the original hang
  // reachable by the shorter path.
  const work = (async (): Promise<number> => {
    const opened = await createChannel();

    if (timedOut) {
      // The budget expired while this channel was being opened. Nothing is
      // waiting for it; hand it straight back rather than leaking it.
      void opened.close().catch(() => undefined);
      throw new QueueProbeTimeoutError(queue, timeoutMs);
    }

    // Both listeners attach before the channel is used. 'error' is the one that
    // would otherwise crash the process; 'close' is what tells the finally block
    // below whether there is still a channel to close.
    const markClosed = (): void => {
      closed = true;
    };
    opened.on('error', markClosed);
    opened.on('close', markClosed);
    channel = opened;

    const { messageCount } = await opened.checkQueue(queue);
    return messageCount;
  })();

  try {
    // Promise.race subscribes to both, so a late rejection from `work` after the
    // deadline has already won is handled rather than unhandled.
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new QueueProbeTimeoutError(queue, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } catch (err) {
    if (isNotFound(err)) {
      return null;
    }
    throw err;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }

    // On a 404 the server already closed the channel and `close()` would reject
    // with IllegalOperationError. The flag is reliable rather than racy: the
    // server-close path rejects the pending reply and then emits 'error'
    // synchronously, while the `await` above resumes on a microtask — so the
    // listener has always run by the time this block does.
    if (channel && !closed) {
      if (timedOut) {
        // A broker that did not answer the declare has no reason to answer
        // channel.close either, and awaiting it here would re-introduce the hang
        // the timeout just escaped. Hand the channel back best-effort and let
        // the timeout propagate; the connection closing reclaims it.
        void channel.close().catch(() => undefined);
      } else {
        await channel.close();
      }
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
