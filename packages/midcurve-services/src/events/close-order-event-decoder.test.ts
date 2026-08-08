/**
 * Close order event decoding and routing — vault variant
 *
 * Covers the mechanism that made the fallback path NFT-only (issue #77):
 * the vault events carry different parameter types, so their topic0 differs
 * from the NFT events, and an eth_getLogs filter built from the NFT ABI alone
 * excludes every vault event even when the vault closer address is polled.
 *
 * apps/midcurve-onchain-data has no test infrastructure, so the parts of that
 * path which live in this package are pinned here: the topic0 divergence, the
 * decode (including the owner, without which position resolution is
 * impossible), and the routing key.
 */

import { describe, it, expect } from 'vitest';
import { encodeEventTopics, encodeAbiParameters, keccak256, toHex } from 'viem';
import {
  UniswapV3PositionCloserV100Abi,
  UniswapV3VaultPositionCloserV100Abi,
} from '@midcurve/shared';
import {
  buildCloseOrderEvent,
  closeOrderRoutingKeyForEvent,
  type RawEventLog,
} from './close-order-event-decoder.js';

const CHAIN_ID = 42161;
const CLOSER = '0x13d13B15BbE9b06C0279a7aB5f0a898EA3f25A40';
const VAULT = '0x7eBA4a00B7991a99A5F7FC7C9C50F2f0d0dFFEe8';
const OWNER = '0x31bB7b5b7ddf4ad0fc90261Dffe655CDdAeed941';
const POOL = '0xC6962004f452bE9203591991D15f6b388e09E8D0';
const OPERATOR = '0x1111111111111111111111111111111111111111';
const PAYOUT = '0x2222222222222222222222222222222222222222';

/** topic0 for an event name, computed from an ABI the way eth_getLogs needs it */
function topic0(abi: readonly unknown[], name: string): string {
  const item = (abi as Array<{ type: string; name: string; inputs: Array<{ type: string }> }>).find(
    (i) => i.type === 'event' && i.name === name,
  );
  if (!item) throw new Error(`event ${name} not in ABI`);
  return keccak256(toHex(`${item.name}(${item.inputs.map((i) => i.type).join(',')})`));
}

/**
 * A real vault OrderRegistered log, ABI-encoded.
 *
 * Indexed args go to topics, the rest to data — built from the ABI item itself
 * so it stays correct if the event's parameter list ever shifts.
 */
function vaultRegisteredLog(): RawEventLog {
  const args: Record<string, unknown> = {
    vault: VAULT,
    triggerMode: 0,
    owner: OWNER,
    pool: POOL,
    operator: OPERATOR,
    payout: PAYOUT,
    triggerTick: -201_120,
    shares: 1_000_000_000_000_000_000n,
    validUntil: 1_800_000_000n,
    slippageBps: 100,
    swapDirection: 0,
    swapSlippageBps: 0,
  };

  const item = (
    UniswapV3VaultPositionCloserV100Abi as unknown as Array<{
      type: string;
      name: string;
      inputs: Array<{ type: string; name: string; indexed?: boolean }>;
    }>
  ).find((i) => i.type === 'event' && i.name === 'OrderRegistered')!;

  const topics = encodeEventTopics({
    abi: UniswapV3VaultPositionCloserV100Abi,
    eventName: 'OrderRegistered',
    args: Object.fromEntries(
      item.inputs.filter((i) => i.indexed).map((i) => [i.name, args[i.name]]),
    ),
  } as never);

  const unindexed = item.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(
    unindexed.map((i) => ({ type: i.type, name: i.name })),
    unindexed.map((i) => args[i.name]),
  );

  return {
    address: CLOSER,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    data,
    blockNumber: 492_389_530n,
    transactionHash: '0xabc0000000000000000000000000000000000000000000000000000000000001',
    logIndex: 4,
  };
}

describe('vault close order events', () => {
  it('has a different topic0 from the NFT event of the same name', () => {
    // This is why an NFT-only topic filter silently excluded every vault event
    expect(topic0(UniswapV3VaultPositionCloserV100Abi, 'OrderRegistered')).not.toBe(
      topic0(UniswapV3PositionCloserV100Abi, 'OrderRegistered'),
    );
  });

  it('is matched by the topic0 of the log it produces', () => {
    const log = vaultRegisteredLog();
    expect(log.topics[0]).toBe(topic0(UniswapV3VaultPositionCloserV100Abi, 'OrderRegistered'));
  });

  it('decodes to a vault event carrying vault, owner and shares', () => {
    const event = buildCloseOrderEvent(CHAIN_ID, CLOSER, vaultRegisteredLog());

    expect(event).not.toBeNull();
    expect(event!.type).toBe('close-order.registered.uniswapv3-vault');
    expect(event!.vaultAddress).toBe(VAULT);
    // Without the owner, a vault event cannot be resolved to a position at all
    expect(event!.ownerAddress).toBe(OWNER);
    expect(event!.nftId).toBeUndefined();
    expect(event!.triggerMode).toBe('LOWER');

    const payload = event!.payload as { owner: string; shares?: string; triggerTick: number };
    expect(payload.owner).toBe(OWNER);
    expect(payload.triggerTick).toBe(-201_120);
    // bigint stays a string across the wire
    expect(payload.shares).toBe('1000000000000000000');
  });

  it('routes on the vault key shape, not the NFT one', () => {
    const event = buildCloseOrderEvent(CHAIN_ID, CLOSER, vaultRegisteredLog());
    expect(closeOrderRoutingKeyForEvent(event!)).toBe(
      `closer.vault.${CHAIN_ID}.${VAULT}.LOWER`,
    );
  });

  it('refuses to route an event with no identifiers rather than dropping it silently', () => {
    expect(() =>
      closeOrderRoutingKeyForEvent({
        type: 'close-order.registered.uniswapv3',
        chainId: CHAIN_ID,
        contractAddress: CLOSER,
        triggerMode: 'LOWER',
        blockNumber: '1',
        transactionHash: '0xdead',
        logIndex: 0,
        receivedAt: new Date(0).toISOString(),
        payload: {},
      } as never),
    ).toThrow(/neither nftId nor vaultAddress/);
  });
});
