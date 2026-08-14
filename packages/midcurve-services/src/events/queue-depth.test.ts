import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type { Channel } from 'amqplib';
import {
  probeQueueDepths,
  QueueProbeTimeoutError,
  type ProbeChannelFactory,
} from './queue-depth.js';

// =============================================================================
// Fakes
// =============================================================================

/**
 * Stands in for an amqplib Channel, reproducing the two behaviours the probe is
 * built around (amqplib 0.10.9, lib/channel.js:313-331):
 *
 * - a passive declare against a missing queue rejects with `code: 404`
 * - the same failure emits 'error' on the channel and moves it to closed, so
 *   `close()` afterwards is an illegal operation
 */
class FakeChannel extends EventEmitter {
  closeCalls = 0;
  checkedQueues: string[] = [];
  private serverClosed = false;

  constructor(private readonly depths: Record<string, number>) {
    super();
  }

  async checkQueue(queue: string): Promise<{ queue: string; messageCount: number }> {
    if (this.serverClosed) {
      throw new Error('Channel closed');
    }
    this.checkedQueues.push(queue);

    const messageCount = this.depths[queue];
    if (messageCount === undefined) {
      return this.failWithNotFound(queue);
    }

    return { queue, messageCount };
  }

  async close(): Promise<void> {
    this.closeCalls++;
    if (this.serverClosed) {
      throw new Error('IllegalOperationError: Channel closed');
    }
    this.emit('close');
  }

  /** Reject the pending reply, then emit 'error' — in that order, as amqplib does. */
  private failWithNotFound(queue: string): never {
    const err = new Error(
      `Channel closed by server: 404 (NOT-FOUND) with message "NOT_FOUND - no queue '${queue}' in vhost '/'"`
    ) as Error & { code: number };
    err.code = 404;

    this.serverClosed = true;
    this.emit('error', err);
    throw err;
  }
}

/** Hands out a fresh FakeChannel per call, and records them. */
function channelFactory(depths: Record<string, number>): {
  factory: ProbeChannelFactory;
  channels: FakeChannel[];
} {
  const channels: FakeChannel[] = [];
  const factory: ProbeChannelFactory = async () => {
    const channel = new FakeChannel(depths);
    channels.push(channel);
    return channel as unknown as Channel;
  };
  return { factory, channels };
}

// =============================================================================
// Tests
// =============================================================================

describe('probeQueueDepths', () => {
  it('reports the depth of each queue, in the order given', async () => {
    const { factory } = channelFactory({ 'a.dlq': 3, 'b.dlq': 0, 'c.dlq': 17 });

    const depths = await probeQueueDepths(factory, ['a.dlq', 'b.dlq', 'c.dlq']);

    expect(depths).toEqual([
      { queue: 'a.dlq', messages: 3 },
      { queue: 'b.dlq', messages: 0 },
      { queue: 'c.dlq', messages: 17 },
    ]);
  });

  it('reports a missing queue as null rather than throwing', async () => {
    const { factory } = channelFactory({});

    const depths = await probeQueueDepths(factory, ['absent.dlq']);

    expect(depths).toEqual([{ queue: 'absent.dlq', messages: null }]);
  });

  // Zero and absent are different readings, and collapsing them is what makes a
  // probe report "nothing wrong" about a queue it never found.
  it('distinguishes an empty queue from a missing one', async () => {
    const { factory } = channelFactory({ 'empty.dlq': 0 });

    const depths = await probeQueueDepths(factory, ['empty.dlq', 'absent.dlq']);

    expect(depths).toEqual([
      { queue: 'empty.dlq', messages: 0 },
      { queue: 'absent.dlq', messages: null },
    ]);
  });

  // The branch most likely to be wrong, and the reason this module has a suite:
  // a blanket catch would turn a closed connection into a confident "absent".
  it('rethrows anything that is not a missing queue', async () => {
    const factory: ProbeChannelFactory = async () => {
      const channel = new EventEmitter() as unknown as Channel;
      channel.checkQueue = vi.fn().mockRejectedValue(
        Object.assign(new Error('ACCESS_REFUSED'), { code: 403 })
      );
      channel.close = vi.fn().mockResolvedValue(undefined);
      return channel;
    };

    await expect(probeQueueDepths(factory, ['forbidden.dlq'])).rejects.toThrow(
      'ACCESS_REFUSED'
    );
  });

  it('rethrows an error carrying no reply code at all', async () => {
    const factory: ProbeChannelFactory = async () => {
      const channel = new EventEmitter() as unknown as Channel;
      channel.checkQueue = vi.fn().mockRejectedValue(new Error('Connection closed'));
      channel.close = vi.fn().mockResolvedValue(undefined);
      return channel;
    };

    await expect(probeQueueDepths(factory, ['any.dlq'])).rejects.toThrow(
      'Connection closed'
    );
  });

  it('uses a channel of its own for every queue', async () => {
    const { factory, channels } = channelFactory({ 'a.dlq': 1, 'b.dlq': 2 });

    await probeQueueDepths(factory, ['a.dlq', 'b.dlq']);

    expect(channels).toHaveLength(2);
    expect(channels[0]!.checkedQueues).toEqual(['a.dlq']);
    expect(channels[1]!.checkedQueues).toEqual(['b.dlq']);
  });

  // Sharing one channel across the three probes would report b and c as absent
  // the moment a is missing — which is precisely a fresh broker.
  it('does not let a missing queue poison the queues probed after it', async () => {
    const { factory } = channelFactory({ 'b.dlq': 5, 'c.dlq': 0 });

    const depths = await probeQueueDepths(factory, ['a.dlq', 'b.dlq', 'c.dlq']);

    expect(depths).toEqual([
      { queue: 'a.dlq', messages: null },
      { queue: 'b.dlq', messages: 5 },
      { queue: 'c.dlq', messages: 0 },
    ]);
  });

  it('closes the channel it opened when the probe succeeds', async () => {
    const { factory, channels } = channelFactory({ 'a.dlq': 1 });

    await probeQueueDepths(factory, ['a.dlq']);

    expect(channels[0]!.closeCalls).toBe(1);
  });

  it('closes every channel when several queues are probed', async () => {
    const { factory, channels } = channelFactory({ 'a.dlq': 1, 'b.dlq': 2 });

    await probeQueueDepths(factory, ['a.dlq', 'b.dlq']);

    expect(channels.map((c) => c.closeCalls)).toEqual([1, 1]);
  });

  it('does not close a channel the server already closed', async () => {
    const { factory, channels } = channelFactory({});

    await probeQueueDepths(factory, ['absent.dlq']);

    expect(channels[0]!.closeCalls).toBe(0);
  });

  // An 'error' event with no listener is an uncaught exception in Node. A probe
  // that crashes the process is worse than the dead channel it avoids.
  it('listens for error before touching the channel, so a 404 cannot crash the process', async () => {
    const { factory, channels } = channelFactory({});

    await probeQueueDepths(factory, ['absent.dlq']);

    // listenerCount would be 0 if the probe attached nothing, and EventEmitter
    // rethrows an unhandled 'error' — which the assertion above would not reach.
    expect(channels[0]!.listenerCount('error')).toBeGreaterThan(0);
  });

  it('closes the channel even when the error is rethrown', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const factory: ProbeChannelFactory = async () => {
      const channel = new EventEmitter() as unknown as Channel;
      channel.checkQueue = vi.fn().mockRejectedValue(new Error('Connection closed'));
      channel.close = close;
      return channel;
    };

    await expect(probeQueueDepths(factory, ['any.dlq'])).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('opens no channel at all for an empty queue list', async () => {
    const { factory, channels } = channelFactory({});

    const depths = await probeQueueDepths(factory, []);

    expect(depths).toEqual([]);
    expect(channels).toHaveLength(0);
  });

  // A broker that is connected but no longer answering leaves checkQueue
  // unsettled until the AMQP heartbeat gives up. Unbounded, that is a hung
  // endpoint rather than a slow one — which to a liveness probe is a dead
  // service.
  describe('when the broker stops answering', () => {
    /** checkQueue and close both never settle, as a stalled broker behaves. */
    function stalledFactory(): { factory: ProbeChannelFactory; closeCalls: () => number } {
      let closeCalls = 0;
      const factory: ProbeChannelFactory = async () => {
        const channel = new EventEmitter() as unknown as Channel;
        channel.checkQueue = vi.fn().mockReturnValue(new Promise(() => undefined));
        channel.close = vi.fn().mockImplementation(() => {
          closeCalls++;
          return new Promise(() => undefined);
        });
        return channel;
      };
      return { factory, closeCalls: () => closeCalls };
    }

    it('gives up on the budget instead of waiting forever', async () => {
      const { factory } = stalledFactory();

      await expect(
        probeQueueDepths(factory, ['stalled.dlq'], { timeoutMs: 50 })
      ).rejects.toThrow(QueueProbeTimeoutError);
    });

    it('names the queue and the budget in the error', async () => {
      const { factory } = stalledFactory();

      await expect(
        probeQueueDepths(factory, ['stalled.dlq'], { timeoutMs: 50 })
      ).rejects.toThrow("Timed out after 50ms probing queue 'stalled.dlq'");
    });

    // The close would hang for the same reason checkQueue did. Awaiting it in
    // the finally block would re-introduce exactly the hang the timeout escaped.
    it('does not wait on the close of a channel it gave up on', async () => {
      const { factory, closeCalls } = stalledFactory();

      await expect(
        probeQueueDepths(factory, ['stalled.dlq'], { timeoutMs: 50 })
      ).rejects.toThrow(QueueProbeTimeoutError);

      // Attempted — the channel is handed back best-effort — but not awaited,
      // which is why this assertion is reached at all.
      expect(closeCalls()).toBe(1);
    });

    // Opening a channel is itself a round trip, so a stalled broker hangs here
    // before there is any declare to time out. Racing only the declare would
    // leave the hang reachable by the shorter path.
    it('gives up when the channel itself never opens', async () => {
      const factory: ProbeChannelFactory = () => new Promise(() => undefined);

      await expect(
        probeQueueDepths(factory, ['stalled.dlq'], { timeoutMs: 50 })
      ).rejects.toThrow(QueueProbeTimeoutError);
    });

    it('hands back a channel that opens after the budget expired', async () => {
      const close = vi.fn().mockResolvedValue(undefined);
      const factory: ProbeChannelFactory = () =>
        new Promise((resolve) => {
          setTimeout(() => {
            const channel = new EventEmitter() as unknown as Channel;
            channel.checkQueue = vi.fn().mockResolvedValue({ queue: 'x', messageCount: 0 });
            channel.close = close;
            resolve(channel);
          }, 80);
        });

      await expect(
        probeQueueDepths(factory, ['slow.dlq'], { timeoutMs: 30 })
      ).rejects.toThrow(QueueProbeTimeoutError);

      // The late channel is closed rather than leaked.
      await new Promise((r) => setTimeout(r, 120));
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('stops at the first stalled queue rather than paying the budget per queue', async () => {
      const { factory } = stalledFactory();
      const started = Date.now();

      await expect(
        probeQueueDepths(factory, ['a.dlq', 'b.dlq', 'c.dlq'], { timeoutMs: 50 })
      ).rejects.toThrow(QueueProbeTimeoutError);

      expect(Date.now() - started).toBeLessThan(150);
    });
  });

  it('does not delay a probe that answers well inside the budget', async () => {
    const { factory } = channelFactory({ 'a.dlq': 1 });
    const started = Date.now();

    await probeQueueDepths(factory, ['a.dlq'], { timeoutMs: 5000 });

    expect(Date.now() - started).toBeLessThan(500);
  });
});
