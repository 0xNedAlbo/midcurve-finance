/**
 * Source Event Key
 *
 * Identifies the on-chain log a database row was derived from:
 *
 *     "{chainId}/{transactionHash}/{logIndex}"
 *
 * Used as AutomationLog.sourceEventKey, where @@unique([positionId, sourceEventKey])
 * makes replayed events idempotent — see #79. The key is a plain string rather than
 * a hash: this table is read by a human reconstructing what happened to an order, and
 * a self-describing key is worth more there than a shorter one.
 *
 * `chainId` is strictly redundant given a transaction hash, and included for the same
 * reason.
 *
 * Two producers publish close order events — the fallback poller (via
 * fetchHistoricalCloseOrderEvents) and publishCloseOrderEventsFromReceipt — and both
 * build their envelope through buildCloseOrderEvent. So live and replayed copies of
 * one on-chain log carry the same transactionHash and logIndex by construction, and
 * this key is stable across them. That is the property the whole dedupe rests on; if
 * a third producer is ever added, it goes through buildCloseOrderEvent too.
 *
 * It was three until #88 deleted the startup catch-up, which shared the poller's
 * scanner. Replays now come from the poller re-scanning a range whose cursor did not
 * advance — which this key makes idempotent, and which is exactly why the cursor is
 * allowed to hold back.
 */

/** The on-chain log a row was derived from */
export interface SourceEventIdentity {
  chainId: number;
  transactionHash: string;
  logIndex: number;
}

/**
 * Builds the source event key for an on-chain log.
 *
 * The transaction hash is lowercased. Every producer passes an RPC-supplied hash,
 * which is lowercase already, so this changes nothing today — it removes a silent
 * way for the key to stop matching if a producer ever normalizes its case.
 */
export function createSourceEventKey(identity: SourceEventIdentity): string {
  const { chainId, transactionHash, logIndex } = identity;
  return [chainId, transactionHash.toLowerCase(), logIndex].join('/');
}

/**
 * Derives the source event key from a close order domain event envelope.
 *
 * Returns undefined when the envelope carries no usable log identity. The envelope
 * types both fields as non-optional, but viem's Log types logIndex as `number | null`
 * for pending logs — and a key of ".../null" would not merely be useless, it would
 * collide with every other keyless event in the same transaction and suppress rows
 * that are not duplicates. An absent key is unconstrained, which is today's behaviour.
 */
export function sourceEventKeyForCloseOrderEvent(event: {
  chainId: number;
  transactionHash?: string | null;
  logIndex?: number | null;
}): string | undefined {
  const { chainId, transactionHash, logIndex } = event;

  if (!transactionHash) return undefined;
  if (logIndex === null || logIndex === undefined) return undefined;

  return createSourceEventKey({ chainId, transactionHash, logIndex });
}
