import { describe, it, expect } from 'vitest';
import { decodeAbiParameters, size } from 'viem';
import { buildTreasuryInitCode } from './treasury-deploy.js';
import { MIDCURVE_TREASURY_CREATION_BYTECODE } from '../../abis/midcurve-treasury/bytecode.js';

const ADMIN = '0x14Cc912F4796Cf9A5B56D0Da3a5c9C0e2eE5ad01';
const OPERATOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SWAP_ROUTER = '0x5aE412a2105345f770FC6862Be7e8Fb90245C50a';
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';

const CONSTRUCTOR_PARAMS = [
  { name: 'admin_', type: 'address' },
  { name: 'operator_', type: 'address' },
  { name: 'swapRouter_', type: 'address' },
  { name: 'weth_', type: 'address' },
] as const;

describe('MIDCURVE_TREASURY_CREATION_BYTECODE', () => {
  it('is well-formed 0x-prefixed hex of even length', () => {
    expect(MIDCURVE_TREASURY_CREATION_BYTECODE).toMatch(/^0x[0-9a-f]+$/i);
    expect((MIDCURVE_TREASURY_CREATION_BYTECODE.length - 2) % 2).toBe(0);
  });

  it('is non-trivial — a truncated or placeholder artifact would not deploy', () => {
    expect(size(MIDCURVE_TREASURY_CREATION_BYTECODE)).toBeGreaterThan(1000);
  });

  it('carries no unresolved library link placeholders', () => {
    expect(MIDCURVE_TREASURY_CREATION_BYTECODE).not.toContain('__$');
  });
});

describe('buildTreasuryInitCode', () => {
  const args = {
    admin: ADMIN,
    operator: OPERATOR,
    swapRouter: SWAP_ROUTER,
    weth: WETH,
  };

  it('appends exactly 128 bytes of constructor arguments to the creation bytecode', () => {
    const initCode = buildTreasuryInitCode(args);

    expect(size(initCode)).toBe(
      size(MIDCURVE_TREASURY_CREATION_BYTECODE) + 4 * 32,
    );
    expect(initCode.startsWith(MIDCURVE_TREASURY_CREATION_BYTECODE)).toBe(true);
  });

  it('encodes the four addresses in constructor order', () => {
    const initCode = buildTreasuryInitCode(args);
    const encodedArgs = `0x${initCode.slice(
      MIDCURVE_TREASURY_CREATION_BYTECODE.length,
    )}` as const;

    const decoded = decodeAbiParameters(CONSTRUCTOR_PARAMS, encodedArgs);

    expect(decoded).toEqual([ADMIN, OPERATOR, SWAP_ROUTER, WETH]);
  });

  it('normalizes address casing, so a database row and a registry constant agree', () => {
    const lowercased = buildTreasuryInitCode({
      admin: ADMIN.toLowerCase(),
      operator: OPERATOR.toLowerCase(),
      swapRouter: SWAP_ROUTER.toLowerCase(),
      weth: WETH.toLowerCase(),
    });

    expect(lowercased).toBe(buildTreasuryInitCode(args));
  });

  it('produces different init code for a different operator', () => {
    const other = buildTreasuryInitCode({
      ...args,
      operator: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    });

    expect(other).not.toBe(buildTreasuryInitCode(args));
  });

  it('throws on an invalid address rather than encoding garbage', () => {
    expect(() => buildTreasuryInitCode({ ...args, admin: '0xdeadbeef' })).toThrow();
  });
});
