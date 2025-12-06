/**
 * ABI for IBalanceStore
 * From contracts/src/interfaces/IBalanceStore.sol
 */
export const BALANCE_STORE_ABI = [
  // updateBalance(address strategy, uint256 chainId, address token, uint256 balance)
  {
    type: 'function',
    name: 'updateBalance',
    inputs: [
      { name: 'strategy', type: 'address' },
      { name: 'chainId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'balance', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // getBalance(uint256 chainId, address token) returns (uint256)
  {
    type: 'function',
    name: 'getBalance',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  // getAllBalances(uint256 chainId) returns (BalanceEntry[] memory)
  {
    type: 'function',
    name: 'getAllBalances',
    inputs: [{ name: 'chainId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'token', type: 'address' },
          { name: 'balance', type: 'uint256' },
          { name: 'lastUpdated', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  // Events
  {
    type: 'event',
    name: 'BalanceUpdated',
    inputs: [
      { name: 'strategy', type: 'address', indexed: true },
      { name: 'chainId', type: 'uint256', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'balance', type: 'uint256', indexed: false },
    ],
  },
] as const;
