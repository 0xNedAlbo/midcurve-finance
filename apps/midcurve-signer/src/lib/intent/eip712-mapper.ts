/**
 * EIP-712 Mapper
 *
 * Converts domain types (with discriminated unions) to EIP-712 flattened types.
 *
 * EIP-712 doesn't support discriminated unions, so we flatten the types:
 * - AllowedCurrency: includes `address` field (zeroAddress for evmNative)
 * - AllowedEffect: all fields always present
 * - StrategyEnvelope: config hashed as bytes32 (varies by strategyType)
 */

import {
  zeroAddress,
  keccak256,
  toHex,
  type Hex,
  type Address,
} from 'viem';
import type {
  AllowedCurrency,
  AllowedEffect,
  StrategyIntentV1,
} from '@midcurve/shared';

/**
 * EIP-712 flattened AllowedCurrency
 * All possible fields present, with zeroAddress for evmNative
 */
export interface Eip712AllowedCurrency {
  currencyType: string;
  chainId: bigint;
  address: Address;
  symbol: string;
}

/**
 * EIP-712 flattened AllowedEffect
 */
export interface Eip712AllowedEffect {
  effectType: string;
  chainId: bigint;
  contractAddress: Address;
  functionSelector: Hex;
}

/**
 * EIP-712 StrategyEnvelope
 * Config is hashed because it varies by strategyType
 */
export interface Eip712StrategyEnvelope {
  strategyType: string;
  configHash: Hex;
}

/**
 * EIP-712 StrategyIntentV1 message
 */
export interface Eip712StrategyIntentV1 {
  id: string;
  name: string;
  description: string;
  allowedCurrencies: Eip712AllowedCurrency[];
  allowedEffects: Eip712AllowedEffect[];
  strategy: Eip712StrategyEnvelope;
}

/**
 * Hash a config object for EIP-712 signing
 * Uses sorted keys for deterministic hashing
 */
export function hashConfig(config: unknown): Hex {
  const json = JSON.stringify(config, Object.keys(config as object).sort());
  return keccak256(toHex(json));
}

/**
 * Convert domain AllowedCurrency to EIP-712 flattened format
 */
export function toEip712Currency(currency: AllowedCurrency): Eip712AllowedCurrency {
  return {
    currencyType: currency.currencyType,
    chainId: BigInt(currency.chainId),
    address:
      currency.currencyType === 'erc20'
        ? (currency.address as Address)
        : zeroAddress,
    symbol: currency.symbol,
  };
}

/**
 * Convert EIP-712 flattened currency back to domain type
 */
export function fromEip712Currency(eip712: Eip712AllowedCurrency): AllowedCurrency {
  if (eip712.currencyType === 'erc20') {
    return {
      currencyType: 'erc20',
      chainId: Number(eip712.chainId),
      address: eip712.address,
      symbol: eip712.symbol,
    };
  }
  return {
    currencyType: 'evmNative',
    chainId: Number(eip712.chainId),
    symbol: eip712.symbol,
  };
}

/**
 * Convert domain AllowedEffect to EIP-712 format
 */
export function toEip712Effect(effect: AllowedEffect): Eip712AllowedEffect {
  return {
    effectType: effect.effectType,
    chainId: BigInt(effect.chainId),
    contractAddress: effect.address as Address,
    functionSelector: effect.selector as Hex,
  };
}

/**
 * Convert EIP-712 flattened effect back to domain type
 */
export function fromEip712Effect(eip712: Eip712AllowedEffect): AllowedEffect {
  return {
    effectType: 'evmContractCall',
    chainId: Number(eip712.chainId),
    address: eip712.contractAddress,
    selector: eip712.functionSelector,
  };
}

/**
 * Convert domain StrategyIntentV1 to EIP-712 message format
 */
export function toEip712Intent(intent: StrategyIntentV1): Eip712StrategyIntentV1 {
  return {
    id: intent.id,
    name: intent.name ?? '',
    description: intent.description ?? '',
    allowedCurrencies: intent.allowedCurrencies.map(toEip712Currency),
    allowedEffects: intent.allowedEffects.map(toEip712Effect),
    strategy: {
      strategyType: intent.strategy.strategyType,
      configHash: hashConfig(intent.strategy.config),
    },
  };
}
