/**
 * Tests for AutomationLogService — source event key dedupe (#79)
 *
 * The property under test is the one the write mechanism exists for: processing
 * the same on-chain event any number of times leaves the same set of log rows as
 * processing it once, and does so without erroring.
 *
 * The Prisma mock below enforces @@unique([positionId, sourceEventKey]) the way
 * Postgres does — including the part that carries the whole migration story: NULLs
 * in a unique index are distinct, so keyless rows never conflict with anything.
 * Without that, the mock would "prove" a dedupe that also silently swallowed every
 * executor-written log.
 *
 * What this file deliberately does NOT prove: that the real database suppresses the
 * row, and that a conflicting write leaves the enclosing transaction usable. A mock
 * cannot show either — both are demonstrated once against a real database and the
 * output recorded in the PR. See #79.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient, AutomationLog, Prisma } from '@midcurve/database';
import {
  AutomationLogService,
  AutomationLogType,
  LogLevel,
} from './automation-log-service.js';
import { createSourceEventKey } from '../../utils/automation/source-event-key.js';

const POSITION_ID = 'position-1';
const CLOSE_ORDER_ID = 'order-1';

const SOURCE_EVENT_KEY = createSourceEventKey({
  chainId: 42161,
  transactionHash: '0xabc0000000000000000000000000000000000000000000000000000000000001',
  logIndex: 7,
});

/**
 * In-memory stand-in for the automation_logs table, enforcing the unique index.
 *
 * Postgres semantics that matter here:
 * - (positionId, sourceEventKey) is unique
 * - a NULL sourceEventKey never conflicts, so keyless rows are unconstrained
 */
function createTableMock() {
  const rows: Array<Record<string, unknown>> = [];
  let nextId = 1;

  const conflicts = (data: Record<string, unknown>): boolean => {
    const key = data.sourceEventKey;
    if (key === null || key === undefined) return false; // NULLs are distinct
    return rows.some(
      (row) => row.positionId === data.positionId && row.sourceEventKey === key
    );
  };

  const insert = (data: Record<string, unknown>): AutomationLog => {
    const row = {
      id: `log-${nextId++}`,
      createdAt: new Date('2026-08-13T00:00:00Z'),
      closeOrderId: null,
      context: null,
      sourceEventKey: null,
      ...data,
    };
    rows.push(row);
    return row as unknown as AutomationLog;
  };

  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (conflicts(data)) {
      // Prisma surfaces a unique violation as P2002. In Postgres this also aborts
      // the enclosing transaction, which is precisely why the keyed path must not
      // use create().
      const error = new Error('Unique constraint failed') as Error & { code: string };
      error.code = 'P2002';
      throw error;
    }
    return insert(data);
  });

  const createMany = vi.fn(
    async ({
      data,
      skipDuplicates,
    }: {
      data: Record<string, unknown>[];
      skipDuplicates?: boolean;
    }) => {
      let count = 0;
      for (const item of data) {
        if (conflicts(item)) {
          if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
          const error = new Error('Unique constraint failed') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        insert(item);
        count++;
      }
      return { count };
    }
  );

  return { rows, create, createMany };
}

describe('AutomationLogService — source event key', () => {
  let table: ReturnType<typeof createTableMock>;
  let service: AutomationLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    table = createTableMock();
    const prisma = {
      automationLog: { create: table.create, createMany: table.createMany },
    } as unknown as PrismaClient;
    service = new AutomationLogService({ prisma });
  });

  const keyedInput = () => ({
    positionId: POSITION_ID,
    closeOrderId: CLOSE_ORDER_ID,
    level: LogLevel.INFO,
    logType: AutomationLogType.ORDER_MODIFIED,
    message: '[SL@2,000.00] Close order modified: slippage',
    context: { orderTag: 'SL@2,000.00', changes: 'slippage', chainId: 42161 },
    sourceEventKey: SOURCE_EVENT_KEY,
  });

  describe('replay of the same source event', () => {
    it('writes one row for two identical keyed writes', async () => {
      const first = await service.log(keyedInput());
      const second = await service.log(keyedInput());

      // Asserted before the return values on purpose: this is the defect in #79,
      // and it is what should read out of a failure here.
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0]!.sourceEventKey).toBe(SOURCE_EVENT_KEY);
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it('does not throw on the suppressed write', async () => {
      await service.log(keyedInput());
      await expect(service.log(keyedInput())).resolves.toBe(false);
    });

    it('uses a conflict-tolerant write, never create(), when a key is present', async () => {
      await service.log(keyedInput());

      expect(table.createMany).toHaveBeenCalledTimes(1);
      expect(table.create).not.toHaveBeenCalled();

      const args = table.createMany.mock.calls[0]![0] as {
        data: Record<string, unknown>[];
        skipDuplicates?: boolean;
      };
      expect(args.skipDuplicates).toBe(true);
      expect(args.data[0]!.sourceEventKey).toBe(SOURCE_EVENT_KEY);
    });
  });

  describe('writes that do not originate from an on-chain event', () => {
    const unkeyedInput = (message: string) => ({
      positionId: POSITION_ID,
      closeOrderId: CLOSE_ORDER_ID,
      level: LogLevel.INFO,
      logType: AutomationLogType.ORDER_TRIGGERED,
      message,
      context: { orderTag: 'SL@2,000.00' },
    });

    it('uses a plain create when no key is present', async () => {
      const result = await service.log(unkeyedInput('first'));

      expect(result).toBe(true);
      expect(table.create).toHaveBeenCalledTimes(1);
      expect(table.createMany).not.toHaveBeenCalled();
    });

    it('stays repeatable — identical keyless writes both land', async () => {
      await service.log(unkeyedInput('same message'));
      await service.log(unkeyedInput('same message'));

      expect(table.rows).toHaveLength(2);
    });
  });

  describe('a different source event is not suppressed', () => {
    it('writes a second row for a different logIndex in the same transaction', async () => {
      await service.log(keyedInput());
      await service.log({
        ...keyedInput(),
        sourceEventKey: createSourceEventKey({
          chainId: 42161,
          transactionHash:
            '0xabc0000000000000000000000000000000000000000000000000000000000001',
          logIndex: 8,
        }),
      });

      expect(table.rows).toHaveLength(2);
    });

    it('scopes the key per position', async () => {
      await service.log(keyedInput());
      await service.log({ ...keyedInput(), positionId: 'position-2' });

      expect(table.rows).toHaveLength(2);
    });
  });

  describe('transaction client', () => {
    it('writes through the passed transaction client rather than the base client', async () => {
      const txTable = createTableMock();
      const tx = {
        automationLog: { create: txTable.create, createMany: txTable.createMany },
      } as unknown as Prisma.TransactionClient;

      await service.log(keyedInput(), tx);

      expect(txTable.createMany).toHaveBeenCalledTimes(1);
      expect(table.createMany).not.toHaveBeenCalled();
    });
  });

  describe('convenience methods thread the key through', () => {
    it('logOrderModified passes sourceEventKey to the keyed write', async () => {
      await service.logOrderModified(
        POSITION_ID,
        CLOSE_ORDER_ID,
        { orderTag: 'SL@2,000.00', changes: 'slippage', chainId: 42161 },
        { sourceEventKey: SOURCE_EVENT_KEY }
      );

      expect(table.createMany).toHaveBeenCalledTimes(1);
      const args = table.createMany.mock.calls[0]![0] as {
        data: Record<string, unknown>[];
      };
      expect(args.data[0]!.sourceEventKey).toBe(SOURCE_EVENT_KEY);
      expect(args.data[0]!.logType).toBe(AutomationLogType.ORDER_MODIFIED);
    });

    it('logOrderModified without a key falls back to a plain create', async () => {
      await service.logOrderModified(POSITION_ID, CLOSE_ORDER_ID, {
        orderTag: 'SL@2,000.00',
        changes: 'slippage',
        chainId: 42161,
      });

      expect(table.create).toHaveBeenCalledTimes(1);
      expect(table.createMany).not.toHaveBeenCalled();
    });

    it('replaying logOrderModified with the same key leaves one row', async () => {
      const call = () =>
        service.logOrderModified(
          POSITION_ID,
          CLOSE_ORDER_ID,
          { orderTag: 'SL@2,000.00', changes: 'slippage', chainId: 42161 },
          { sourceEventKey: SOURCE_EVENT_KEY }
        );

      await call();
      await call();

      expect(table.rows).toHaveLength(1);
    });
  });
});
