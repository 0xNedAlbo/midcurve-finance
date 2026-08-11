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
 * authority.
 *
 * ## Allocated but never broadcast
 *
 * The old caller-reads-the-chain behaviour was self-healing by accident: a signature that
 * was never sent cost nothing, because the next caller re-read the same number. An
 * allocator does not get that for free. A number spent without a transaction reaching the
 * chain leaves a gap, and every later transaction queues behind it.
 *
 * That matters most exactly where it is most likely: the refuel fires *because* the
 * operator is low, so a node rejecting the refuel for insufficient funds is a realistic
 * way to spend a nonce and send nothing.
 *
 * Two mechanisms, in order of preference:
 *
 * 1. `release()` — the caller hands the number back when signing or broadcast fails. This
 *    is the fast path and closes the gap immediately.
 * 2. `STALE_AFTER_MS` — a counter that has sat ahead of the chain for longer than the
 *    window is treated as stranded and reset down to it. This is the backstop for the case
 *    release cannot cover: the caller dying between signature and broadcast. Anything
 *    genuinely in flight during that window would have moved `chainNonce` up as it mined.
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
 * This is the backstop, not the primary recovery — release() is. It has to be long enough
 * that a slow-but-alive transaction is never reset out from under itself, which would
 * reintroduce exactly the double-spend of a nonce this service exists to prevent. A
 * transaction can legitimately sit pending for minutes on L1, so the window is generous;
 * the cost of being generous is bounded because release() handles the common failure
 * directly rather than waiting this out.
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

  /**
   * Hand a nonce back after signing or broadcast failed, so it is reused rather than
   * leaving a gap the chain will never fill.
   *
   * Rolls back only when the released nonce is the most recent allocation — that is the
   * only case where rolling back cannot step on someone else. If another allocation
   * happened in between, the counter is left alone: reusing a number that a live
   * transaction is already carrying is the failure this service exists to prevent, and a
   * gap is the lesser of the two. The staleness reset in allocate() is what clears that
   * case, once the chain has demonstrably not moved.
   *
   * Best-effort by nature. A caller that dies before calling this leaves the gap to the
   * staleness path, which is why both exist.
   *
   * @returns whether the counter was actually rolled back
   */
  async release(input: {
    chainId: number;
    address: string;
    nonce: number;
  }): Promise<{ rolledBack: boolean }> {
    const { chainId, nonce } = input;
    const address = normalizeAddress(input.address);

    const rowsAffected = await prisma.$executeRaw`
      UPDATE "public"."operator_nonces"
      SET "nextNonce" = ${nonce}, "updatedAt" = NOW()
      WHERE "chainId" = ${chainId}
        AND "address" = ${address}
        AND "nextNonce" = ${nonce} + 1
    `;

    const rolledBack = rowsAffected > 0;

    if (rolledBack) {
      this.logger.info({
        chainId,
        address,
        nonce,
        msg: 'Released unbroadcast operator nonce; it will be reused by the next signing',
      });
    } else {
      this.logger.warn({
        chainId,
        address,
        nonce,
        msg: 'Could not release operator nonce — a later allocation already took its place. The gap clears via the staleness reset once the chain has not moved.',
      });
    }

    return { rolledBack };
  }
}

// Export singleton instance
export const operatorNonceService = new OperatorNonceServiceImpl();
export { OperatorNonceServiceImpl };
