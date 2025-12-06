/**
 * ABI for the SystemRegistry contract
 * Source: contracts/src/interfaces/ISystemRegistry.sol
 */
export const SYSTEM_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'poolStore',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'positionStore',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceStore',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setPoolStore',
    inputs: [{ name: '_poolStore', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setPositionStore',
    inputs: [{ name: '_positionStore', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setBalanceStore',
    inputs: [{ name: '_balanceStore', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'PoolStoreUpdated',
    inputs: [
      { name: 'oldAddress', type: 'address', indexed: true },
      { name: 'newAddress', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'PositionStoreUpdated',
    inputs: [
      { name: 'oldAddress', type: 'address', indexed: true },
      { name: 'newAddress', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'BalanceStoreUpdated',
    inputs: [
      { name: 'oldAddress', type: 'address', indexed: true },
      { name: 'newAddress', type: 'address', indexed: true },
    ],
  },
] as const;
