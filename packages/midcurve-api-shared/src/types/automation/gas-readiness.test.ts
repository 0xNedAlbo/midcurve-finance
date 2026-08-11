import { describe, it, expect } from 'vitest';
import {
  GasReadinessQuerySchema,
  RegisterTreasuryBodySchema,
  GAS_READINESS_STATUSES,
  GAS_READINESS_UNAVAILABLE_REASONS,
} from './gas-readiness.js';

describe('GasReadinessQuerySchema', () => {
  it('accepts a checksummed wallet address', () => {
    const result = GasReadinessQuerySchema.safeParse({
      walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a lowercase wallet address — checksumming happens server-side', () => {
    const result = GasReadinessQuerySchema.safeParse({
      walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an absent wallet address — the readiness check does not require one', () => {
    expect(GasReadinessQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects a truncated address', () => {
    expect(
      GasReadinessQuerySchema.safeParse({ walletAddress: '0xdeadbeef' }).success,
    ).toBe(false);
  });

  it('rejects an address without the 0x prefix', () => {
    expect(
      GasReadinessQuerySchema.safeParse({
        walletAddress: 'f39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      }).success,
    ).toBe(false);
  });
});

describe('RegisterTreasuryBodySchema', () => {
  it('accepts a well-formed address', () => {
    const result = RegisterTreasuryBodySchema.safeParse({
      address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    });
    expect(result.success).toBe(true);
  });

  it('requires an address — there is nothing to derive it from', () => {
    expect(RegisterTreasuryBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-address string', () => {
    expect(
      RegisterTreasuryBodySchema.safeParse({ address: 'not-an-address' }).success,
    ).toBe(false);
  });
});

describe('status constants', () => {
  it('covers the four readiness outcomes', () => {
    expect([...GAS_READINESS_STATUSES]).toEqual([
      'ready',
      'needs-kickstart',
      'needs-topup',
      'unavailable',
    ]);
  });

  it('names every reason a chain can be unavailable', () => {
    expect(GAS_READINESS_UNAVAILABLE_REASONS).toContain('no-swap-router');
    expect(GAS_READINESS_UNAVAILABLE_REASONS).toContain('no-admin-address');
    expect(GAS_READINESS_UNAVAILABLE_REASONS).toContain('no-operator-address');
  });
});
