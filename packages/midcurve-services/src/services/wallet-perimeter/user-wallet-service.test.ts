import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserWalletService } from './user-wallet-service.js';
import type { PrismaClient } from '@midcurve/database';

/**
 * UserWalletService — EVM is the only accepted wallet type.
 *
 * Bitcoin and Solana were removed as wallet platforms (issue #114). The
 * `walletType` discriminator is kept as a seam, but every value other than
 * 'evm' must be rejected rather than passed through unvalidated — the old
 * solana/bitcoin branches concatenated the raw address into a walletHash
 * with no validation step at all.
 */

describe('UserWalletService — walletType is EVM-only', () => {
  const create = vi.fn();
  const findFirst = vi.fn();
  const mockPrisma = {
    userWallet: { create, findFirst },
  } as unknown as PrismaClient;

  let service: UserWalletService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserWalletService({ prisma: mockPrisma });
  });

  const LOWERCASE = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
  const CHECKSUMMED = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

  describe('evm', () => {
    it('builds a checksummed walletHash and config on create', async () => {
      create.mockResolvedValue({ id: 'w1' });

      await service.create({
        userId: 'u1',
        walletType: 'evm',
        address: LOWERCASE,
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          walletType: 'evm',
          walletHash: `evm/${CHECKSUMMED}`,
          config: { address: CHECKSUMMED },
          isPrimary: false,
        }),
      });
    });

    it('normalizes the address before lookup', async () => {
      findFirst.mockResolvedValue(null);

      await service.findByTypeAndAddress('evm', LOWERCASE);

      expect(findFirst).toHaveBeenCalledWith({
        where: { walletHash: `evm/${CHECKSUMMED}` },
      });
    });
  });

  describe.each(['solana', 'bitcoin', 'sui', ''])('walletType %j', (walletType) => {
    it('is rejected on create, and nothing is written', async () => {
      await expect(
        service.create({ userId: 'u1', walletType, address: LOWERCASE })
      ).rejects.toThrow(`Unsupported wallet type: ${walletType}`);

      expect(create).not.toHaveBeenCalled();
    });

    it('is rejected on findByTypeAndAddress, and nothing is queried', async () => {
      await expect(
        service.findByTypeAndAddress(walletType, LOWERCASE)
      ).rejects.toThrow(`Unsupported wallet type: ${walletType}`);

      expect(findFirst).not.toHaveBeenCalled();
    });

    it('is rejected on isUserWallet, and nothing is queried', async () => {
      await expect(
        service.isUserWallet('u1', walletType, LOWERCASE)
      ).rejects.toThrow(`Unsupported wallet type: ${walletType}`);

      expect(findFirst).not.toHaveBeenCalled();
    });
  });
});
