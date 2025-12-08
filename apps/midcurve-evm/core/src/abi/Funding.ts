/**
 * ABI for IFunding interface
 * From contracts/src/interfaces/IFunding.sol
 *
 * Note: Withdrawals are now handled via signed requests to Core's WithdrawalApi,
 * not via contract events. This simplifies the flow and allows withdrawals
 * regardless of strategy state.
 */
export const FUNDING_ABI = [
  // ============= Events =============

  // EthBalanceUpdateRequested(bytes32 indexed requestId, uint256 indexed chainId)
  {
    type: 'event',
    name: 'EthBalanceUpdateRequested',
    inputs: [
      { name: 'requestId', type: 'bytes32', indexed: true },
      { name: 'chainId', type: 'uint256', indexed: true },
    ],
  },

  // ============= Owner Functions =============

  // updateEthBalance(uint256 chainId) returns (bytes32 requestId)
  {
    type: 'function',
    name: 'updateEthBalance',
    inputs: [{ name: 'chainId', type: 'uint256' }],
    outputs: [{ name: 'requestId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },

  // ============= Core Callbacks =============

  // onErc20Deposit(uint256 chainId, address token, uint256 amount)
  {
    type: 'function',
    name: 'onErc20Deposit',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // onEthBalanceUpdated(uint256 chainId, uint256 balance)
  {
    type: 'function',
    name: 'onEthBalanceUpdated',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'balance', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // onWithdrawComplete(bytes32 requestId, bool success, bytes32 txHash, string errorMessage)
  {
    type: 'function',
    name: 'onWithdrawComplete',
    inputs: [
      { name: 'requestId', type: 'bytes32' },
      { name: 'success', type: 'bool' },
      { name: 'txHash', type: 'bytes32' },
      { name: 'errorMessage', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ============= Balance Query Functions =============

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
] as const;

/**
 * Minimal ERC-20 ABI for transfer operations
 * Used by funding executor for withdrawals
 */
export const ERC20_ABI = [
  // transfer(address to, uint256 amount) returns (bool)
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },

  // balanceOf(address account) returns (uint256)
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },

  // decimals() returns (uint8)
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },

  // symbol() returns (string)
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },

  // Transfer(address indexed from, address indexed to, uint256 value)
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;
