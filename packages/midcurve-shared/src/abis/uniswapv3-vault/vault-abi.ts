// ============================================================================
// UniswapV3Vault ABI
// Minimal ABI for service layer reads + event log filtering.
// ============================================================================

/**
 * Vault contract ABI — view functions and events used by the service layer.
 * Does not include write functions (mint, burn, collectFees) — those are
 * called by the frontend via wagmi, not by the service layer.
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

  // ============ Vault identity views ============
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

  // ============ Fee + quote views ============
  {
    type: 'function',
    name: 'claimableFees',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'fee0', type: 'uint256' },
      { name: 'fee1', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'quoteBurn',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
      { name: 'deltaL', type: 'uint128' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'quoteMint',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
      { name: 'deltaL', type: 'uint128' },
    ],
    stateMutability: 'view',
  },

  // ============ Vault events ============
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
      { name: 'to', type: 'address', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'deltaL', type: 'uint128', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Burned',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'deltaL', type: 'uint128', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FeesCollected',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'fee0', type: 'uint256', indexed: false },
      { name: 'fee1', type: 'uint256', indexed: false },
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
 * Factory contract ABI — VaultCreated event for wallet discovery.
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
