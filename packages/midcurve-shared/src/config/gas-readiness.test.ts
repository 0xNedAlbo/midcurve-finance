import { describe, it, expect } from 'vitest';
import {
  GAS_READINESS_CONFIG,
  getGasReadinessConfig,
  hasGasReadinessConfig,
  getProductionChainsMissingGasReadiness,
} from './gas-readiness.js';
import { PRODUCTION_CHAIN_IDS } from './chain-registry.js';

describe('gas readiness configuration', () => {
  it('covers every production chain', () => {
    expect(getProductionChainsMissingGasReadiness()).toEqual([]);
  });

  it('covers Ethereum, Arbitrum and Base explicitly', () => {
    for (const chainId of [1, 42161, 8453]) {
      expect(hasGasReadinessConfig(chainId)).toBe(true);
    }
  });

  it('funds more than the threshold on every chain', () => {
    // A funding amount at or below the threshold would leave the operator
    // still short after a top-up, and re-offer the same step forever.
    for (const [chainId, config] of Object.entries(GAS_READINESS_CONFIG)) {
      expect(
        config.fundingAmountWei > config.readinessThresholdWei,
        `chain ${chainId}`,
      ).toBe(true);
    }
  });

  it('uses positive bigint amounts throughout', () => {
    for (const [chainId, config] of Object.entries(GAS_READINESS_CONFIG)) {
      expect(typeof config.readinessThresholdWei, `chain ${chainId}`).toBe('bigint');
      expect(typeof config.fundingAmountWei, `chain ${chainId}`).toBe('bigint');
      expect(config.readinessThresholdWei > 0n, `chain ${chainId}`).toBe(true);
    }
  });

  it('prices Ethereum above the L2s — an L1 execution costs orders of magnitude more', () => {
    const ethereum = getGasReadinessConfig(1);
    const arbitrum = getGasReadinessConfig(42161);

    expect(ethereum.readinessThresholdWei > arbitrum.readinessThresholdWei).toBe(true);
    expect(ethereum.fundingAmountWei > arbitrum.fundingAmountWei).toBe(true);
  });

  it('throws for an unconfigured chain rather than defaulting', () => {
    expect(() => getGasReadinessConfig(999999)).toThrow(/No gas readiness configuration/);
  });
});
