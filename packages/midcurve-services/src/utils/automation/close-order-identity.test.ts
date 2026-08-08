/**
 * createCloseOrderIdentityHash — unit tests
 *
 * This helper is the contract between the two writers of CloseOrder rows (the
 * on-chain event rule and UniswapV3CloseOrderService.refresh()). If they ever
 * disagree on a single character, the same slot produces two rows and collides
 * on @@unique([positionId, closeOrderHash]) — so the shape is pinned here.
 */

import { describe, it, expect } from 'vitest';
import { ContractTriggerMode } from '@midcurve/shared';
import { createCloseOrderIdentityHash } from './close-order-identity.js';

const CHAIN_ID = 42161;
const VAULT_CHECKSUMMED = '0x13d13B15BbE9b06C0279a7aB5f0a898EA3f25A40';
const OWNER_CHECKSUMMED = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

describe('createCloseOrderIdentityHash', () => {
  describe('uniswapv3 (NFT)', () => {
    it('builds "uniswapv3/{chainId}/{nftId}/{triggerMode}"', () => {
      expect(
        createCloseOrderIdentityHash({
          protocol: 'uniswapv3',
          chainId: CHAIN_ID,
          nftId: '12345',
          triggerMode: ContractTriggerMode.LOWER,
        }),
      ).toBe('uniswapv3/42161/12345/0');
    });

    it('accepts a numeric nftId and both trigger modes', () => {
      expect(
        createCloseOrderIdentityHash({
          protocol: 'uniswapv3',
          chainId: 1,
          nftId: 42,
          triggerMode: ContractTriggerMode.UPPER,
        }),
      ).toBe('uniswapv3/1/42/1');
    });

    it('throws when the nftId is missing', () => {
      expect(() =>
        createCloseOrderIdentityHash({
          protocol: 'uniswapv3',
          chainId: CHAIN_ID,
          nftId: '',
          triggerMode: ContractTriggerMode.LOWER,
        }),
      ).toThrow(/requires nftId/);
    });
  });

  describe('uniswapv3-vault', () => {
    it('builds "uniswapv3-vault/{chainId}/{vault}/{owner}/{triggerMode}"', () => {
      expect(
        createCloseOrderIdentityHash({
          protocol: 'uniswapv3-vault',
          chainId: CHAIN_ID,
          vaultAddress: VAULT_CHECKSUMMED,
          ownerAddress: OWNER_CHECKSUMMED,
          triggerMode: ContractTriggerMode.LOWER,
        }),
      ).toBe(
        `uniswapv3-vault/42161/${VAULT_CHECKSUMMED}/${OWNER_CHECKSUMMED}/0`,
      );
    });

    it('normalizes addresses to EIP-55, whatever casing the caller passes', () => {
      const fromLowercase = createCloseOrderIdentityHash({
        protocol: 'uniswapv3-vault',
        chainId: CHAIN_ID,
        vaultAddress: VAULT_CHECKSUMMED.toLowerCase(),
        ownerAddress: OWNER_CHECKSUMMED.toLowerCase(),
        triggerMode: ContractTriggerMode.UPPER,
      });
      const fromChecksummed = createCloseOrderIdentityHash({
        protocol: 'uniswapv3-vault',
        chainId: CHAIN_ID,
        vaultAddress: VAULT_CHECKSUMMED,
        ownerAddress: OWNER_CHECKSUMMED,
        triggerMode: ContractTriggerMode.UPPER,
      });

      expect(fromLowercase).toBe(fromChecksummed);
      expect(fromLowercase).toContain(VAULT_CHECKSUMMED);
      expect(fromLowercase).toContain(OWNER_CHECKSUMMED);
    });

    it('separates owners on the same vault — two holders, two slots', () => {
      const other = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

      const first = createCloseOrderIdentityHash({
        protocol: 'uniswapv3-vault',
        chainId: CHAIN_ID,
        vaultAddress: VAULT_CHECKSUMMED,
        ownerAddress: OWNER_CHECKSUMMED,
        triggerMode: ContractTriggerMode.LOWER,
      });
      const second = createCloseOrderIdentityHash({
        protocol: 'uniswapv3-vault',
        chainId: CHAIN_ID,
        vaultAddress: VAULT_CHECKSUMMED,
        ownerAddress: other,
        triggerMode: ContractTriggerMode.LOWER,
      });

      expect(first).not.toBe(second);
    });

    it('separates trigger modes — one LOWER and one UPPER slot per position', () => {
      const lower = createCloseOrderIdentityHash({
        protocol: 'uniswapv3-vault',
        chainId: CHAIN_ID,
        vaultAddress: VAULT_CHECKSUMMED,
        ownerAddress: OWNER_CHECKSUMMED,
        triggerMode: ContractTriggerMode.LOWER,
      });
      const upper = createCloseOrderIdentityHash({
        protocol: 'uniswapv3-vault',
        chainId: CHAIN_ID,
        vaultAddress: VAULT_CHECKSUMMED,
        ownerAddress: OWNER_CHECKSUMMED,
        triggerMode: ContractTriggerMode.UPPER,
      });

      expect(lower).not.toBe(upper);
    });

    it('matches the address casing of the vault position hash', () => {
      // Position hash: uniswapv3-vault/{chainId}/{vaultAddress}/{ownerAddress}
      const positionHash = `uniswapv3-vault/${CHAIN_ID}/${VAULT_CHECKSUMMED}/${OWNER_CHECKSUMMED}`;
      const identityHash = createCloseOrderIdentityHash({
        protocol: 'uniswapv3-vault',
        chainId: CHAIN_ID,
        vaultAddress: VAULT_CHECKSUMMED.toLowerCase(),
        ownerAddress: OWNER_CHECKSUMMED.toLowerCase(),
        triggerMode: ContractTriggerMode.LOWER,
      });

      expect(identityHash).toBe(`${positionHash}/0`);
    });

    it('throws when the owner address is missing', () => {
      expect(() =>
        createCloseOrderIdentityHash({
          protocol: 'uniswapv3-vault',
          chainId: CHAIN_ID,
          vaultAddress: VAULT_CHECKSUMMED,
          ownerAddress: '',
          triggerMode: ContractTriggerMode.LOWER,
        }),
      ).toThrow(/requires vaultAddress and ownerAddress/);
    });

    it('throws on a malformed address rather than storing it', () => {
      expect(() =>
        createCloseOrderIdentityHash({
          protocol: 'uniswapv3-vault',
          chainId: CHAIN_ID,
          vaultAddress: '0xnope',
          ownerAddress: OWNER_CHECKSUMMED,
          triggerMode: ContractTriggerMode.LOWER,
        }),
      ).toThrow();
    });
  });
});
