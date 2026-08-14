import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type { Channel } from 'amqplib';
import { probeQueueDepths, type ProbeChannelFactory } from './queue-depth.js';

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
});
