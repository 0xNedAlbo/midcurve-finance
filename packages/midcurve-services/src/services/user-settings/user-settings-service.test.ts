import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserSettingsService } from './user-settings-service.js';
import type { PrismaClient } from '@midcurve/database';
import type { FavoritePoolEntry, PoolTableColumnId } from '@midcurve/shared';

/**
 * UserSettingsService — lazy backwards-compatibility for `favoritePoolHashes`.
 *
 * Pre-issue-#45 entries were stored as plain strings (pool hashes only).
 * Reads must accept both shapes (`string` and `{ hash, isToken0Quote? }`)
 * and normalize to `FavoritePoolEntry[]`. Writes always emit the object form.
 */

describe('UserSettingsService — favoritePoolHashes lazy compat', () => {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const mockPrisma = {
    userSettings: { findUnique, upsert },
  } as unknown as PrismaClient;

  let service: UserSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserSettingsService({ prisma: mockPrisma });
  });

  function row(favoritePoolHashes: unknown): { settings: unknown } {
    return {
      settings: {
        favoritePoolHashes,
        costBasisMethod: 'fifo',
      },
    };
  }

  describe('getByUserId / getFavoritePoolEntries — read normalization', () => {
    it('returns DEFAULT_USER_SETTINGS when no row exists', async () => {
      findUnique.mockResolvedValue(null);
      const settings = await service.getByUserId('u1');
      expect(settings.favoritePoolHashes).toEqual([]);
      expect(settings.costBasisMethod).toBe('fifo');
    });

    it('normalizes legacy string entries to FavoritePoolEntry shape', async () => {
      findUnique.mockResolvedValue(
        row(['uniswapv3/1/0xAbC', 'uniswapv3/42161/0xDeF'])
      );
      const entries = await service.getFavoritePoolEntries('u1');
      expect(entries).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xAbC' },
        { hash: 'uniswapv3/42161/0xDeF' },
      ]);
    });

    it('preserves isToken0Quote on object-shape entries', async () => {
      findUnique.mockResolvedValue(
        row([
          { hash: 'uniswapv3/1/0xAbC', isToken0Quote: true },
          { hash: 'uniswapv3/42161/0xDeF', isToken0Quote: false },
          { hash: 'uniswapv3/8453/0x111' },
        ])
      );
      const entries = await service.getFavoritePoolEntries('u1');
      expect(entries).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xAbC', isToken0Quote: true },
        { hash: 'uniswapv3/42161/0xDeF', isToken0Quote: false },
        { hash: 'uniswapv3/8453/0x111' },
      ]);
    });

    it('handles a mixed array (legacy strings + new objects) round-tripped from one user', async () => {
      findUnique.mockResolvedValue(
        row([
          'uniswapv3/1/0xAbC',
          { hash: 'uniswapv3/42161/0xDeF', isToken0Quote: true },
        ])
      );
      const entries = await service.getFavoritePoolEntries('u1');
      expect(entries).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xAbC' },
        { hash: 'uniswapv3/42161/0xDeF', isToken0Quote: true },
      ]);
    });

    it('drops malformed entries silently (null, numbers, missing hash)', async () => {
      findUnique.mockResolvedValue(
        row([
          'uniswapv3/1/0xAbC',
          null,
          42,
          { isToken0Quote: true }, // no hash
          { hash: 123 }, // hash not a string
          { hash: 'uniswapv3/8453/0x111', isToken0Quote: 'truthy' }, // wrong type → drop the bool but keep entry
        ])
      );
      const entries = await service.getFavoritePoolEntries('u1');
      expect(entries).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xAbC' },
        { hash: 'uniswapv3/8453/0x111' },
      ]);
    });

    it('returns [] when favoritePoolHashes is missing or not an array', async () => {
      findUnique.mockResolvedValue({ settings: { costBasisMethod: 'fifo' } });
      let entries = await service.getFavoritePoolEntries('u1');
      expect(entries).toEqual([]);

      findUnique.mockResolvedValue(row('not-an-array'));
      entries = await service.getFavoritePoolEntries('u1');
      expect(entries).toEqual([]);
    });
  });

  describe('addFavoritePoolEntry — always writes object shape', () => {
    it('appends as { hash, isToken0Quote } when orientation supplied', async () => {
      findUnique.mockResolvedValue(row([]));
      upsert.mockImplementation(async ({ create }: { create: { settings: unknown } }) => ({
        settings: create.settings,
      }));

      const result = await service.addFavoritePoolEntry(
        'u1',
        'uniswapv3/1/0xAbC',
        true
      );

      expect(result.favoritePoolHashes).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xAbC', isToken0Quote: true },
      ]);
      // Verify the actual JSON shape persisted to Prisma carries the object form.
      const upsertArgs = upsert.mock.calls[0][0];
      const persisted = upsertArgs.create.settings as {
        favoritePoolHashes: unknown[];
      };
      expect(persisted.favoritePoolHashes[0]).toEqual({
        hash: 'uniswapv3/1/0xAbC',
        isToken0Quote: true,
      });
    });

    it('appends as { hash } only when orientation is undefined', async () => {
      findUnique.mockResolvedValue(row([]));
      upsert.mockImplementation(async ({ create }: { create: { settings: unknown } }) => ({
        settings: create.settings,
      }));

      const result = await service.addFavoritePoolEntry('u1', 'uniswapv3/1/0xAbC');
      expect(result.favoritePoolHashes).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xAbC' },
      ]);
    });

    it('upgrades a legacy string entry to the object shape on re-add (orientation provided)', async () => {
      // Existing storage has a legacy string for the same hash.
      findUnique.mockResolvedValue(row(['uniswapv3/1/0xAbC']));
      upsert.mockImplementation(async ({ update }: { update: { settings: unknown } }) => ({
        settings: update.settings,
      }));

      const result = await service.addFavoritePoolEntry(
        'u1',
        'uniswapv3/1/0xAbC',
        false
      );

      // Prepended (most-recent-first) AND deduped.
      expect(result.favoritePoolHashes).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xAbC', isToken0Quote: false },
      ]);
    });

    it('moves existing entry to the front when re-added (idempotent)', async () => {
      findUnique.mockResolvedValue(
        row([
          { hash: 'uniswapv3/1/0xAAA' },
          { hash: 'uniswapv3/1/0xBBB', isToken0Quote: true },
          { hash: 'uniswapv3/1/0xCCC' },
        ])
      );
      upsert.mockImplementation(async ({ update }: { update: { settings: unknown } }) => ({
        settings: update.settings,
      }));

      const result = await service.addFavoritePoolEntry(
        'u1',
        'uniswapv3/1/0xCCC',
        true
      );

      expect(result.favoritePoolHashes.map((e) => e.hash)).toEqual([
        'uniswapv3/1/0xCCC',
        'uniswapv3/1/0xAAA',
        'uniswapv3/1/0xBBB',
      ]);
      // Re-added entry now carries the new orientation.
      expect(result.favoritePoolHashes[0]).toEqual({
        hash: 'uniswapv3/1/0xCCC',
        isToken0Quote: true,
      });
    });
  });

  describe('removeFavoritePoolEntry — filters by hash, ignores orientation', () => {
    it('removes the entry whose hash matches', async () => {
      findUnique.mockResolvedValue(
        row([
          { hash: 'uniswapv3/1/0xAAA', isToken0Quote: true },
          { hash: 'uniswapv3/1/0xBBB' },
        ])
      );
      upsert.mockImplementation(async ({ update }: { update: { settings: unknown } }) => ({
        settings: update.settings,
      }));

      const result = await service.removeFavoritePoolEntry('u1', 'uniswapv3/1/0xAAA');
      expect(result.favoritePoolHashes).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xBBB' },
      ]);
    });

    it('removes a legacy string entry by its hash', async () => {
      findUnique.mockResolvedValue(
        row(['uniswapv3/1/0xAAA', 'uniswapv3/1/0xBBB'])
      );
      upsert.mockImplementation(async ({ update }: { update: { settings: unknown } }) => ({
        settings: update.settings,
      }));

      const result = await service.removeFavoritePoolEntry('u1', 'uniswapv3/1/0xAAA');
      expect(result.favoritePoolHashes).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xBBB' },
      ]);
    });

    it('is idempotent (no-op when hash not present)', async () => {
      findUnique.mockResolvedValue(row([{ hash: 'uniswapv3/1/0xAAA' }]));
      upsert.mockImplementation(async ({ update }: { update: { settings: unknown } }) => ({
        settings: update.settings,
      }));

      const result = await service.removeFavoritePoolEntry(
        'u1',
        'uniswapv3/1/0xZZZ'
      );
      expect(result.favoritePoolHashes).toEqual<FavoritePoolEntry[]>([
        { hash: 'uniswapv3/1/0xAAA' },
      ]);
    });
  });

  describe('isFavoritePoolHash', () => {
    it('returns true when the hash is present (object form)', async () => {
      findUnique.mockResolvedValue(
        row([{ hash: 'uniswapv3/1/0xAAA', isToken0Quote: true }])
      );
      const isFav = await service.isFavoritePoolHash('u1', 'uniswapv3/1/0xAAA');
      expect(isFav).toBe(true);
    });

    it('returns true when the hash is present (legacy string form)', async () => {
      findUnique.mockResolvedValue(row(['uniswapv3/1/0xAAA']));
      const isFav = await service.isFavoritePoolHash('u1', 'uniswapv3/1/0xAAA');
      expect(isFav).toBe(true);
    });

    it('returns false when the hash is absent', async () => {
      findUnique.mockResolvedValue(row([{ hash: 'uniswapv3/1/0xAAA' }]));
      const isFav = await service.isFavoritePoolHash('u1', 'uniswapv3/1/0xZZZ');
      expect(isFav).toBe(false);
    });
  });
});

describe('UserSettingsService — poolTableVisibleColumns', () => {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const mockPrisma = {
    userSettings: { findUnique, upsert },
  } as unknown as PrismaClient;

  let service: UserSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserSettingsService({ prisma: mockPrisma });
  });

  function row(value: unknown): { settings: unknown } {
    return {
      settings: {
        favoritePoolHashes: [],
        costBasisMethod: 'fifo',
        poolTableVisibleColumns: value,
      },
    };
  }

  const DEFAULT_COLUMNS: PoolTableColumnId[] = ['tvl', 'feeApr7d', 'lvrCoverage'];

  describe('getPoolTableVisibleColumns — read normalization', () => {
    it('returns defaults when no row exists', async () => {
      findUnique.mockResolvedValue(null);
      const cols = await service.getPoolTableVisibleColumns('u1');
      expect(cols).toEqual(DEFAULT_COLUMNS);
    });

    it('returns defaults when the field is missing (legacy row)', async () => {
      findUnique.mockResolvedValue({
        settings: { favoritePoolHashes: [], costBasisMethod: 'fifo' },
      });
      const cols = await service.getPoolTableVisibleColumns('u1');
      expect(cols).toEqual(DEFAULT_COLUMNS);
    });

    it('returns defaults when the field is not an array', async () => {
      findUnique.mockResolvedValue(row('not-an-array'));
      const cols = await service.getPoolTableVisibleColumns('u1');
      expect(cols).toEqual(DEFAULT_COLUMNS);
    });

    it('round-trips a valid stored array', async () => {
      findUnique.mockResolvedValue(
        row(['tvl', 'feeApr7d', 'volume7dAvg', 'verdict60d'])
      );
      const cols = await service.getPoolTableVisibleColumns('u1');
      expect(cols).toEqual<PoolTableColumnId[]>([
        'tvl',
        'feeApr7d',
        'volume7dAvg',
        'verdict60d',
      ]);
    });

    it('drops unknown ids silently', async () => {
      findUnique.mockResolvedValue(
        row(['tvl', 'unknownColumn', 'feeApr7d', null, 42, 'lvrCoverage'])
      );
      const cols = await service.getPoolTableVisibleColumns('u1');
      expect(cols).toEqual<PoolTableColumnId[]>([
        'tvl',
        'feeApr7d',
        'lvrCoverage',
      ]);
    });

    it('de-duplicates while preserving first occurrence', async () => {
      findUnique.mockResolvedValue(
        row(['tvl', 'feeApr7d', 'tvl', 'lvrCoverage', 'feeApr7d'])
      );
      const cols = await service.getPoolTableVisibleColumns('u1');
      expect(cols).toEqual<PoolTableColumnId[]>([
        'tvl',
        'feeApr7d',
        'lvrCoverage',
      ]);
    });

    it('accepts an empty array (user can hide everything)', async () => {
      findUnique.mockResolvedValue(row([]));
      const cols = await service.getPoolTableVisibleColumns('u1');
      expect(cols).toEqual([]);
    });
  });

  describe('updatePoolTableVisibleColumns — write normalization', () => {
    it('persists the validated set and returns the full settings', async () => {
      findUnique.mockResolvedValue(row(DEFAULT_COLUMNS));
      upsert.mockImplementation(async ({ update }: { update: { settings: unknown } }) => ({
        settings: update.settings,
      }));

      const result = await service.updatePoolTableVisibleColumns('u1', [
        'tvl',
        'volume7dAvg',
        'lvrThreshold',
      ]);

      expect(result.poolTableVisibleColumns).toEqual<PoolTableColumnId[]>([
        'tvl',
        'volume7dAvg',
        'lvrThreshold',
      ]);
      const upsertArgs = upsert.mock.calls[0][0];
      const persisted = upsertArgs.update.settings as {
        poolTableVisibleColumns: unknown[];
      };
      expect(persisted.poolTableVisibleColumns).toEqual([
        'tvl',
        'volume7dAvg',
        'lvrThreshold',
      ]);
    });

    it('drops unknown ids before persisting', async () => {
      findUnique.mockResolvedValue(row(DEFAULT_COLUMNS));
      upsert.mockImplementation(async ({ update }: { update: { settings: unknown } }) => ({
        settings: update.settings,
      }));

      const result = await service.updatePoolTableVisibleColumns('u1', [
        'tvl',
        'bogus',
        'lvrCoverage',
      ]);
      expect(result.poolTableVisibleColumns).toEqual<PoolTableColumnId[]>([
        'tvl',
        'lvrCoverage',
      ]);
    });

    it('persists an empty array verbatim', async () => {
      findUnique.mockResolvedValue(row(DEFAULT_COLUMNS));
      upsert.mockImplementation(async ({ update }: { update: { settings: unknown } }) => ({
        settings: update.settings,
      }));

      const result = await service.updatePoolTableVisibleColumns('u1', []);
      expect(result.poolTableVisibleColumns).toEqual([]);
    });
  });
});
