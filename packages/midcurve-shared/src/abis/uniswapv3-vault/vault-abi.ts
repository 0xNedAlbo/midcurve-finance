// ============================================================================
// UniswapV3Vault ABI — implements IMultiTokenVault / IMultiTokenVaultAllowlisted
// Minimal ABI for service layer reads + event log filtering.
// ============================================================================

/**
 * Vault contract ABI — view functions, write functions, and events.
 * Covers both IMultiTokenVault interface functions and UniswapV3-specific getters.
 * Write functions (mint) are called by the frontend via wagmi.
 */
export const UniswapV3VaultAbi = [
  // ============ ERC-20 views ============
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },

  // ============ IMultiTokenVault — Identification ============
  {
    type: 'function',
    name: 'vaultType',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokens',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },

  // ============ IMultiTokenVault — Operator ============
  {
    type: 'function',
    name: 'operator',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },

  // ============ UniswapV3-specific views ============
  {
    type: 'function',
    name: 'positionManager',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token0',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token1',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pool',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tickLower',
    inputs: [],
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tickUpper',
    inputs: [],
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
  },

  // ============ IMultiTokenVault — Yield + quote views ============
  {
    type: 'function',
    name: 'claimableYield',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'tokenAmounts', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'quoteBurn',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [
      { name: 'tokenAmounts', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'quoteMint',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [
      { name: 'tokenAmounts', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },

  // ============ IMultiTokenVaultAllowlisted views ============
  {
    type: 'function',
    name: 'allowlistEnabled',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowlistAdmin',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isAllowlisted',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },

  // ============ Write functions ============
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'minShares', type: 'uint256' },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'maxAmounts', type: 'uint256[]' },
          { name: 'minAmounts', type: 'uint256[]' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'tokenAmounts', type: 'uint256[]' },
    ],
    stateMutability: 'nonpayable',
  },

  {
    type: 'function',
    name: 'collectYield',
    inputs: [{ name: 'recipient', type: 'address' }],
    outputs: [{ name: 'tokenAmounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'burn',
    inputs: [
      { name: 'shares', type: 'uint256' },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'minAmounts', type: 'uint256[]' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'tokenAmounts', type: 'uint256[]' },
    ],
    stateMutability: 'nonpayable',
  },

  // ============ IMultiTokenVault events ============
  {
    type: 'event',
    name: 'VaultInitialized',
    inputs: [
      { name: 'positionManager', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'initialShareRecipient', type: 'address', indexed: true },
      { name: 'initialLiquidity', type: 'uint128', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Minted',
    inputs: [
      { name: 'minter', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'tokenAmounts', type: 'uint256[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Burned',
    inputs: [
      { name: 'burner', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'tokenAmounts', type: 'uint256[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'YieldCollected',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'tokenAmounts', type: 'uint256[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TendExecuted',
    inputs: [
      { name: 'operationDiscriminator', type: 'bytes32', indexed: true },
      { name: 'tendParams', type: 'bytes', indexed: false },
      { name: 'tendResults', type: 'bytes', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OperatorUpdated',
    inputs: [
      { name: 'prevOperator', type: 'address', indexed: true },
      { name: 'newOperator', type: 'address', indexed: true },
    ],
  },

  // ============ IMultiTokenVaultAllowlisted events ============
  {
    type: 'event',
    name: 'AllowlistMemberAdded',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'AllowlistMemberRemoved',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'AllowlistDisabled',
    inputs: [],
  },
  {
    type: 'event',
    name: 'AllowlistAdminTransferred',
    inputs: [
      { name: 'prevAdmin', type: 'address', indexed: true },
      { name: 'newAdmin', type: 'address', indexed: true },
    ],
  },

  // ============ ERC-20 Transfer event ============
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

/**
 * Factory contract ABI — createVault/createAllowlistedVault + VaultCreated event.
 */
export const UniswapV3VaultFactoryAbi = [
  // ============ Factory functions ============
  {
    type: 'function',
    name: 'createVault',
    inputs: [
      { name: 'tokenId_', type: 'uint256' },
      { name: 'name_', type: 'string' },
      { name: 'symbol_', type: 'string' },
      { name: 'decimals_', type: 'uint8' },
      { name: 'operator_', type: 'address' },
    ],
    outputs: [{ name: 'vault', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createAllowlistedVault',
    inputs: [
      { name: 'tokenId_', type: 'uint256' },
      { name: 'name_', type: 'string' },
      { name: 'symbol_', type: 'string' },
      { name: 'decimals_', type: 'uint8' },
      { name: 'operator_', type: 'address' },
      { name: 'allowlistAdmin_', type: 'address' },
    ],
    outputs: [{ name: 'vault', type: 'address' }],
    stateMutability: 'nonpayable',
  },

  // ============ Factory events ============
  {
    type: 'event',
    name: 'VaultCreated',
    inputs: [
      { name: 'vault', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'allowlisted', type: 'bool', indexed: false },
    ],
  },
] as const;
