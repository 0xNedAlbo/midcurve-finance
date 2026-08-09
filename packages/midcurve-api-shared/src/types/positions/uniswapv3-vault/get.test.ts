/**
 * GetUniswapV3VaultPositionParamsSchema
 *
 * The path params for every vault route. Addresses must come out EIP-55
 * checksummed whatever case they went in as — the stored positionHash is
 * checksummed, so an un-normalized param resolves nothing and 404s (#80).
 */

import { describe, it, expect } from 'vitest';
import { GetUniswapV3VaultPositionParamsSchema } from './get.js';

const VAULT_CHECKSUMMED = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const VAULT_LOWERCASE = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const VAULT_UPPERCASE = '0xC02AAA39B223FE8D0A0E5C4F27EAD9083C756CC2';

const OWNER_CHECKSUMMED = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const OWNER_LOWERCASE = '0x1f98431c8ad98523631ae4a59f267346ea31f984';

const parse = (params: Record<string, string>) =>
  GetUniswapV3VaultPositionParamsSchema.safeParse(params);

describe('GetUniswapV3VaultPositionParamsSchema', () => {
  describe('address normalization', () => {
    it('normalizes lowercase addresses to EIP-55', () => {
      const result = parse({
        chainId: '42161',
        vaultAddress: VAULT_LOWERCASE,
        ownerAddress: OWNER_LOWERCASE,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        chainId: 42161,
        vaultAddress: VAULT_CHECKSUMMED,
        ownerAddress: OWNER_CHECKSUMMED,
      });
    });

    it('normalizes uppercase-hex addresses to EIP-55', () => {
      const result = parse({
        chainId: '42161',
        vaultAddress: VAULT_UPPERCASE,
        ownerAddress: OWNER_LOWERCASE,
      });

      expect(result.success).toBe(true);
      expect(result.data?.vaultAddress).toBe(VAULT_CHECKSUMMED);
    });

    it('leaves already-checksummed addresses unchanged', () => {
      const result = parse({
        chainId: '42161',
        vaultAddress: VAULT_CHECKSUMMED,
        ownerAddress: OWNER_CHECKSUMMED,
      });

      expect(result.success).toBe(true);
      expect(result.data?.vaultAddress).toBe(VAULT_CHECKSUMMED);
      expect(result.data?.ownerAddress).toBe(OWNER_CHECKSUMMED);
    });

    it('normalizes each address independently', () => {
      const result = parse({
        chainId: '42161',
        vaultAddress: VAULT_LOWERCASE,
        ownerAddress: OWNER_CHECKSUMMED,
      });

      expect(result.success).toBe(true);
      expect(result.data?.vaultAddress).toBe(VAULT_CHECKSUMMED);
      expect(result.data?.ownerAddress).toBe(OWNER_CHECKSUMMED);
    });

    it('re-checksums a wrong-checksum address rather than rejecting it', () => {
      // normalizeAddress() validates case-insensitively, so the EIP-55
      // checksum is not used as an integrity check here. Documented, not
      // accidental — nothing in this system treats it as one.
      const wrongChecksum = '0xc02AAA39B223FE8D0a0E5c4f27EaD9083c756cC2';
      const result = parse({
        chainId: '42161',
        vaultAddress: wrongChecksum,
        ownerAddress: OWNER_LOWERCASE,
      });

      expect(result.success).toBe(true);
      expect(result.data?.vaultAddress).toBe(VAULT_CHECKSUMMED);
    });
  });

  describe('rejects malformed input with a validation error, not a throw', () => {
    it.each([
      ['too short', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc'],
      ['too long', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc22'],
      ['non-hex characters', '0xzzzzzz39b223fe8d0a0e5c4f27ead9083c756cc2'],
      ['missing 0x prefix', 'c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
      ['empty', ''],
    ])('vaultAddress %s', (_label, vaultAddress) => {
      const result = parse({
        chainId: '42161',
        vaultAddress,
        ownerAddress: OWNER_LOWERCASE,
      });

      expect(result.success).toBe(false);
    });

    it.each(['0', '-1', 'abc', ''])('chainId %s', (chainId) => {
      const result = parse({
        chainId,
        vaultAddress: VAULT_LOWERCASE,
        ownerAddress: OWNER_LOWERCASE,
      });

      expect(result.success).toBe(false);
    });
  });
});
