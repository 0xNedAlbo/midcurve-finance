/**
 * UniswapV3VaultPosition.createHash
 *
 * The canonical positionHash builder. Normalizing inside the builder is the
 * point: every construction is EIP-55 regardless of what the caller passes,
 * including call sites no Zod schema protects (services, scripts).
 */

import { describe, it, expect } from 'vitest';
import { UniswapV3VaultPosition } from './uniswapv3-vault-position.js';

const CHAIN_ID = 42161;

// Same address in three notations. The checksummed form is the expected output.
const VAULT_CHECKSUMMED = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const VAULT_LOWERCASE = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const VAULT_UPPERCASE = '0xC02AAA39B223FE8D0A0E5C4F27EAD9083C756CC2';

const OWNER_CHECKSUMMED = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const OWNER_LOWERCASE = '0x1f98431c8ad98523631ae4a59f267346ea31f984';

const EXPECTED = `uniswapv3-vault/${CHAIN_ID}/${VAULT_CHECKSUMMED}/${OWNER_CHECKSUMMED}`;

describe('UniswapV3VaultPosition.createHash', () => {
  it('builds "uniswapv3-vault/{chainId}/{vault}/{owner}"', () => {
    expect(
      UniswapV3VaultPosition.createHash(CHAIN_ID, VAULT_CHECKSUMMED, OWNER_CHECKSUMMED)
    ).toBe(EXPECTED);
  });

  it('normalizes lowercase addresses to EIP-55', () => {
    expect(
      UniswapV3VaultPosition.createHash(CHAIN_ID, VAULT_LOWERCASE, OWNER_LOWERCASE)
    ).toBe(EXPECTED);
  });

  it('normalizes uppercase-hex addresses to EIP-55', () => {
    expect(
      UniswapV3VaultPosition.createHash(CHAIN_ID, VAULT_UPPERCASE, OWNER_LOWERCASE)
    ).toBe(EXPECTED);
  });

  it('is idempotent on already-checksummed input', () => {
    const once = UniswapV3VaultPosition.createHash(
      CHAIN_ID,
      VAULT_CHECKSUMMED,
      OWNER_CHECKSUMMED
    );
    const twice = UniswapV3VaultPosition.createHash(
      CHAIN_ID,
      once.split('/')[2]!,
      once.split('/')[3]!
    );
    expect(twice).toBe(once);
  });

  it('normalizes each address independently', () => {
    expect(
      UniswapV3VaultPosition.createHash(CHAIN_ID, VAULT_LOWERCASE, OWNER_CHECKSUMMED)
    ).toBe(EXPECTED);
    expect(
      UniswapV3VaultPosition.createHash(CHAIN_ID, VAULT_CHECKSUMMED, OWNER_LOWERCASE)
    ).toBe(EXPECTED);
  });

  it('keeps vault and owner in that order', () => {
    const swapped = UniswapV3VaultPosition.createHash(
      CHAIN_ID,
      OWNER_CHECKSUMMED,
      VAULT_CHECKSUMMED
    );
    expect(swapped).not.toBe(EXPECTED);
    expect(swapped).toBe(
      `uniswapv3-vault/${CHAIN_ID}/${OWNER_CHECKSUMMED}/${VAULT_CHECKSUMMED}`
    );
  });

  it('throws on an invalid address rather than emitting a malformed hash', () => {
    expect(() =>
      UniswapV3VaultPosition.createHash(CHAIN_ID, '0xnope', OWNER_CHECKSUMMED)
    ).toThrow(/Invalid Ethereum address/);
    expect(() =>
      UniswapV3VaultPosition.createHash(CHAIN_ID, VAULT_CHECKSUMMED, '')
    ).toThrow(/Invalid Ethereum address/);
  });
});
