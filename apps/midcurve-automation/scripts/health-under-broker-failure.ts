/**
 * /api/health under broker failure — issue #82, criterion 11.
 *
 * Adding a depth probe to a health endpoint puts a network round trip on a path
 * that had none. Two failure modes come with it, and neither is visible from
 * reading the route:
 *
 *   A. broker connected but no longer answering — the probe never settles and
 *      the endpoint hangs, which to a liveness probe is a dead service
 *   C. the connection drops mid-probe — the error escapes the handler and Next
 *      returns a bare 500, less information than the 503-with-body the endpoint
 *      returned before it reported depths at all
 *
 * Both are reproduced here against a TCP proxy that completes the AMQP handshake
 * and then either stops forwarding frames or destroys the sockets. Run with tsx:
 *
 *   pnpm --filter @midcurve/automation exec tsx scripts/health-under-broker-failure.ts
 *
 * The endpoint must answer with a body in every case, deadLetterQueues must read
 * [], and `status` must stay governed by mqConnected exactly as it was before
 * the probe existed.
 */
import net from 'node:net';

// The connection manager reads config at call time, so this must be set before
// anything asks it for a channel.
const PROXY_PORT = 5699;
process.env.RABBITMQ_PORT = String(PROXY_PORT);
process.env.RABBITMQ_HOST = '127.0.0.1';

const { getRabbitMQConnection } = await import('../src/mq/connection-manager');
const { GET } = await import('../src/app/api/health/route');

type Health = {
  status: string;
  checks: {
    rabbitmq: { status: string; message?: string };
    workers: { failedTotal: number };
    deadLetterQueues: unknown[];
  };
};

/** Forwards to the real broker until stall() or drop() is called. */
function stallProxy(): {
  stall: () => void;
  drop: () => void;
  close: () => void;
} {
  const pairs: { client: net.Socket; upstream: net.Socket }[] = [];
  let stalled = false;

  const server = net.createServer((client) => {
    const upstream = net.connect(5672, '127.0.0.1');
    pairs.push({ client, upstream });
    client.on('data', (d) => {
      if (!stalled) upstream.write(d);
    });
    upstream.on('data', (d) => {
      if (!stalled) client.write(d);
    });
    client.on('error', () => undefined);
    upstream.on('error', () => undefined);
  });
  server.listen(PROXY_PORT, '127.0.0.1');

  return {
    stall: () => {
      stalled = true;
    },
    drop: () => {
      for (const { client, upstream } of pairs) {
        client.destroy();
        upstream.destroy();
      }
    },
    close: () => server.close(),
  };
}

async function health(): Promise<{ http: number; body: Health; ms: number }> {
  const started = Date.now();
  const res = await GET();
  return { http: res.status, body: (await res.json()) as Health, ms: Date.now() - started };
}

function show(label: string, r: { http: number; body: Health; ms: number }): void {
  console.log(label);
  console.log(`  HTTP ${r.http}  status=${r.body.status}  rabbitmq=${r.body.checks.rabbitmq.status}`);
  console.log(`  deadLetterQueues=${JSON.stringify(r.body.checks.deadLetterQueues)}`);
  console.log(`  answered in ${r.ms}ms`);
}

async function main(): Promise<void> {
  const proxy = stallProxy();
  await new Promise((r) => setTimeout(r, 300));

  const mq = getRabbitMQConnection();
  await mq.getChannel(); // handshake through the proxy, topology declared
  console.log(`connected through proxy on :${PROXY_PORT}, isConnected=${mq.isConnected()}\n`);

  show('=== control: broker answering ===', await health());

  console.log('\n--- stalling the proxy: frames stop moving in both directions ---');
  proxy.stall();
  show('=== A: broker connected but not answering ===', await health());

  // The drop lands while a probe is in flight, so the rejection comes from the
  // connection rather than from the deadline — a different error class reaching
  // the same catch, and the one that would otherwise have been a bare 500.
  console.log('\n--- C: starting a probe, then destroying the sockets under it ---');
  const inFlight = health();
  await new Promise((r) => setTimeout(r, 200));
  proxy.drop();
  show('=== C: connection dropped mid-probe ===', await inFlight);

  console.log('\n--- D: connection gone before the request arrives ---');
  await new Promise((r) => setTimeout(r, 300));
  show('=== D: not connected ===', await health());

  proxy.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
