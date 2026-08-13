/**
 * viem's timeout error reaches our call site unwrapped — pinned against a real
 * socket.
 *
 * `describeScanFailure` branches on `error instanceof TimeoutError` to decide
 * whether a failed sweep gets the "your RPC plan is the likely cause" sentence
 * or the "it was still running" one. The unit tests for that function supply a
 * TimeoutError directly, which proves the branch formats correctly given one —
 * not that viem produces one here. If viem ever wraps it (HttpRequestError,
 * UnknownRpcError, a re-throw through RpcRequestError), the branch stops firing
 * and a timed-out sweep gets the plan-blaming message: the exact
 * confidently-wrong diagnosis the branch exists to prevent, shipped inside the
 * mechanism meant to prevent it.
 *
 * That failure is unfalsifiable in practice — a full-history sweep measured
 * 703ms against a 120s budget (#88), so nobody will hit a real timeout and
 * discover it. Hence this test: a server that accepts the connection and never
 * answers, the same `http` transport and the same `client.request` call the
 * sweep uses, with the timeout shortened so the test costs 100ms instead of two
 * minutes.
 *
 * If a viem upgrade starts wrapping, this fails and the comment in
 * close-order-scan.ts points at what to change.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createPublicClient, http, TimeoutError } from 'viem';
import { arbitrum } from 'viem/chains';

/** Accepts the request, never responds. */
const blackHole: Server = createServer(() => {
  // Deliberately empty: no writeHead, no end. The client must time out.
});

const listening = new Promise<number>((resolve) => {
  blackHole.listen(0, '127.0.0.1', () => {
    const address = blackHole.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address for the black-hole server');
    }
    resolve(address.port);
  });
});

afterAll(async () => {
  blackHole.closeAllConnections();
  await new Promise<void>((resolve) => blackHole.close(() => resolve()));
});

describe('viem timeout at the sweep call site', () => {
  it('rejects with a TimeoutError instance, not a wrapped error', async () => {
    const port = await listening;

    // Same construction as getScanClient, minus the two-minute budget.
    const client = createPublicClient({
      chain: arbitrum,
      transport: http(`http://127.0.0.1:${port}`, { timeout: 100, retryCount: 0 }),
    });

    const error = await client
      .request({
        method: 'eth_getLogs',
        params: [{ fromBlock: '0x0', toBlock: '0x1' }],
      })
      .then(
        () => {
          throw new Error('expected the request to time out');
        },
        (e: Error) => e
      );

    expect(error).toBeInstanceOf(TimeoutError);
    // The branch reads the class, but assert the name too: it is what a reader
    // sees in the log when this goes wrong.
    expect(error.name).toBe('TimeoutError');
  });
});
