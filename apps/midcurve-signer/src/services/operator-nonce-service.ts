/**
 * Operator Nonce Service
 *
 * The single place a nonce is assigned for a signing EOA on a chain.
 *
 * Two independent processes sign with the operator key — the close-order executor in
 * midcurve-automation and RefuelOperatorRule in midcurve-business-logic. Both used to read
 * the chain nonce themselves and hand it to the signer, so two signings that overlapped
 * could carry the same value and one transaction would be dropped on broadcast. Within a
 * single automation process the executor is serialised by `prefetch: 1` on its queue, but
 * that is a queue setting, not a nonce guarantee: it says nothing about a second process,
 * and nothing about a second automation instance.
 *
 * Allocation happens inside the signing call rather than behind its own route, so there is
 * no way to obtain a signature without passing through here.
 *
 * ## Why the caller still reads the chain
 *
 * The signer is deliberately isolated from RPC (see AutomationSigningService, and the note
 * in .env.example). It therefore cannot observe `getTransactionCount` for itself. The
 * caller — which already has RPC — passes its observation in as `chainNonce`, and this
 * service decides what is actually used. Observation and assignment are split; assignment
 * is what has to be single-sourced, and it is.
 *
 * ## The two directions of disagreement
 *
 * `chainNonce` above the stored counter means the chain moved without us: a transaction
 * landed, or something else signed from this EOA. We follow it.
 *
 * `chainNonce` below the stored counter is the normal in-flight case — we have allocated
 * values that have not yet been mined — and is why the counter, not the chain, is the
 * authority. But it is also what a nonce allocated and never broadcast looks like, when a
 * caller dies between receiving a signature and sending it. That gap never heals on its
 * own: every later transaction queues behind a nonce the chain will never see. So a
 * counter that has been ahead of the chain for longer than STALE_AFTER_MS is treated as
 * stranded and reset down to the chain. Anything genuinely in flight during that window
 * would have moved `chainNonce` up as it mined.
 */

import { randomUUID } from 'node:crypto';
import { normalizeAddress } from '@midcurve/shared';
import { prisma } from '@/lib/prisma';
import { signerLogger } from '@/lib/logger';

// =============================================================================
// Constants
// =============================================================================

/**
 * How long the counter may sit ahead of the chain before it is treated as stranded.
 *
 * Long enough that a slow-but-alive transaction is never reset out from under itself —
 * the executor's own retry budget is three attempts sixty seconds apart — and short
 * enough that a dropped allocation does not wedge the EOA until someone notices.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

export interface AllocateNonceInput {
  chainId: number;
  /** The signing EOA */
  address: string;
  /** The caller's on-chain observation, used as a floor */
  chainNonce: number;
}

export interface AllocatedNonce {
  /** The nonce to sign with */
  nonce: number;
  /**
   * True when the stored counter was ahead of the chain for longer than the staleness
   * window and was reset down to it. Reported so a caller can log it: it means a previous
   * allocation was never broadcast, which is a defect somewhere upstream rather than
   * routine.
   */
  wasReset: boolean;
}

// =============================================================================
// Service
// =============================================================================

class OperatorNonceServiceImpl {
  private readonly logger = signerLogger.child({ service: 'OperatorNonceService' });

  /**
   * Assign the next nonce for (chainId, address).
   *
   * Concurrency-safe by construction: the allocation is a single statement, so Postgres'
   * row lock serialises overlapping callers and the second one reads the value the first
   * already wrote. There is no read-then-write window to lose.
   */
  async allocate(input: AllocateNonceInput): Promise<AllocatedNonce> {
    const { chainId, chainNonce } = input;
    const address = normalizeAddress(input.address);

    if (!Number.isInteger(chainNonce) || chainNonce < 0) {
      throw new Error(
        `chainNonce must be a non-negative integer, received ${chainNonce}`,
      );
    }

    const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
    const id = randomUUID();

    // One statement, so the row lock does the mutual exclusion:
    //
    //   allocated  = chainNonce            when the chain is level or ahead,
    //                                      or when we have been ahead too long to be real
    //              = stored.nextNonce      otherwise (allocations still in flight)
    //   nextNonce := allocated + 1
    //
    // `prev` exists only to report whether a reset happened — RETURNING on an upsert
    // yields the post-update row, so the prior counter is not otherwise recoverable. It
    // reads at statement snapshot rather than under the row lock, so under genuinely
    // concurrent allocation the flag can be misattributed between the two callers. That is
    // tolerable because it is diagnostic; the allocation itself does not depend on it.
    const rows = await prisma.$queryRaw<
      Array<{ nextNonce: number; prevNextNonce: number | null }>
    >`
      WITH prev AS (
        SELECT "nextNonce"
        FROM "public"."operator_nonces"
        WHERE "chainId" = ${chainId} AND "address" = ${address}
      ),
      upserted AS (
        INSERT INTO "public"."operator_nonces" ("id", "chainId", "address", "nextNonce", "createdAt", "updatedAt")
        VALUES (${id}, ${chainId}, ${address}, ${chainNonce} + 1, NOW(), NOW())
        ON CONFLICT ("chainId", "address") DO UPDATE
        SET
          "nextNonce" = CASE
            WHEN ${chainNonce} >= "operator_nonces"."nextNonce" THEN ${chainNonce}
            WHEN "operator_nonces"."updatedAt" < ${staleBefore} THEN ${chainNonce}
            ELSE "operator_nonces"."nextNonce"
          END + 1,
          "updatedAt" = NOW()
        RETURNING "nextNonce"
      )
      SELECT upserted."nextNonce", prev."nextNonce" AS "prevNextNonce"
      FROM upserted LEFT JOIN prev ON TRUE
    `;

    const row = rows[0];
    if (!row) {
      throw new Error(
        `Nonce allocation returned no row for chain ${chainId} address ${address}`,
      );
    }

    const nonce = row.nextNonce - 1;
    // A reset is the case where we had run ahead of the chain and came back down to it,
    // as distinct from the ordinary case of the chain simply being level with us.
    const wasReset =
      row.prevNextNonce !== null &&
      row.prevNextNonce > chainNonce &&
      nonce === chainNonce;

    if (wasReset) {
      this.logger.warn({
        chainId,
        address,
        chainNonce,
        nonce,
        staleAfterMs: STALE_AFTER_MS,
        msg: 'Operator nonce counter was ahead of chain past the staleness window and was reset — a previously allocated nonce was never broadcast',
      });
    }

    this.logger.debug({
      chainId,
      address,
      chainNonce,
      nonce,
      msg: 'Allocated operator nonce',
    });

    return { nonce, wasReset };
  }
}

// Export singleton instance
export const operatorNonceService = new OperatorNonceServiceImpl();
export { OperatorNonceServiceImpl };
