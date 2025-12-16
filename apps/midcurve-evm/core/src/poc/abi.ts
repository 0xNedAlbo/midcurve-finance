/**
 * Contract ABIs for the POC.
 *
 * These are minimal ABIs containing only the functions we need.
 * In production, these would be generated from Foundry build artifacts.
 */

export const SimpleLoggingStrategyAbi = [
  // Constructor
  {
    type: 'constructor',
    inputs: [
      { name: 'operator_', type: 'address' },
      { name: 'core_', type: 'address' },
    ],
  },
  // IStrategy.step
  {
    type: 'function',
    name: 'step',
    inputs: [{ name: 'input', type: 'bytes' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // IStrategy.submitEffectResult
  {
    type: 'function',
    name: 'submitEffectResult',
    inputs: [
      { name: 'epoch_', type: 'uint64' },
      { name: 'idempotencyKey', type: 'bytes32' },
      { name: 'ok', type: 'bool' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // IStrategy.epoch
  {
    type: 'function',
    name: 'epoch',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
  },
  // SimpleLoggingStrategy.eventsProcessed
  {
    type: 'function',
    name: 'eventsProcessed',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  // BaseStrategy.operator
  {
    type: 'function',
    name: 'operator',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  // BaseStrategy.core
  {
    type: 'function',
    name: 'core',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  // Errors
  {
    type: 'error',
    name: 'EffectNeeded',
    inputs: [
      { name: 'epoch', type: 'uint64' },
      { name: 'idempotencyKey', type: 'bytes32' },
      { name: 'effectType', type: 'bytes32' },
      { name: 'payload', type: 'bytes' },
    ],
  },
  {
    type: 'error',
    name: 'NotOperator',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotCore',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidStepEvent',
    inputs: [],
  },
] as const;
