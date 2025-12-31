/**
 * SimpleTokenVault Contract ABI
 *
 * This is the ABI for the SimpleTokenVault contract used for strategy funding.
 * The vault holds ERC20 tokens and ETH for gas, with owner and operator roles.
 *
 * Constructor:
 * - owner_: Address that can deposit/withdraw tokens and ETH
 * - operator_: Address that can use/return funds (automation wallet)
 * - token_: The ERC20 token this vault holds
 */

export const SimpleTokenVaultABI = [
  // Constructor (handled specially by wagmi for contract deployment)
  {
    type: 'constructor',
    inputs: [
      { name: 'owner_', type: 'address', internalType: 'address' },
      { name: 'operator_', type: 'address', internalType: 'address' },
      { name: 'token_', type: 'address', internalType: 'contract IERC20' },
    ],
    stateMutability: 'nonpayable',
  },

  // === Owner Functions ===

  // Deposit ETH for gas reimbursements
  {
    type: 'function',
    name: 'depositGas',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },

  // Withdraw ETH from gas pool
  {
    type: 'function',
    name: 'withdrawGas',
    inputs: [
      { name: 'to', type: 'address', internalType: 'address' },
      { name: 'amountWei', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // Deposit tokens
  {
    type: 'function',
    name: 'deposit',
    inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // Withdraw tokens
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'to', type: 'address', internalType: 'address' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // Shutdown vault (owner only, irreversible)
  {
    type: 'function',
    name: 'shutdown',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // === View Functions ===

  // Get immutable token address
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract IERC20' }],
    stateMutability: 'view',
  },

  // Get immutable owner address
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },

  // Get immutable operator address
  {
    type: 'function',
    name: 'operator',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },

  // Get current token balance
  {
    type: 'function',
    name: 'tokenBalance',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },

  // Get current ETH balance (total)
  {
    type: 'function',
    name: 'ethBalance',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },

  // Get tracked gas pool balance
  {
    type: 'function',
    name: 'gasPool',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },

  // Check if vault is shutdown
  {
    type: 'function',
    name: 'isShutdown',
    inputs: [],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },

  // === Events ===

  // Token events
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'owner', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'owner', type: 'address', indexed: true, internalType: 'address' },
      { name: 'to', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },

  // Gas events
  {
    type: 'event',
    name: 'GasDeposited',
    inputs: [
      { name: 'owner', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amountWei', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'GasWithdrawn',
    inputs: [
      { name: 'owner', type: 'address', indexed: true, internalType: 'address' },
      { name: 'to', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amountWei', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },

  // Shutdown event
  {
    type: 'event',
    name: 'Shutdown',
    inputs: [
      { name: 'owner', type: 'address', indexed: true, internalType: 'address' },
      { name: 'vaultTokenAmount', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'ethAmountWei', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },

  // === Errors ===
  { type: 'error', name: 'NotOwner', inputs: [] },
  { type: 'error', name: 'NotOperator', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'InsufficientGasPool', inputs: [] },
  { type: 'error', name: 'EthTransferFailed', inputs: [] },
  { type: 'error', name: 'DirectEthNotAllowed', inputs: [] },
  { type: 'error', name: 'VaultIsShutdown', inputs: [] },
] as const;

/**
 * Type-safe ABI for wagmi
 */
export type SimpleTokenVaultAbiType = typeof SimpleTokenVaultABI;
