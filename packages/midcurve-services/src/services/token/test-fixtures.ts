/**
 * Test fixtures for TokenService tests
 * Provides reusable, realistic test data for ERC-20 token testing
 */

import type { CreateTokenInput } from '../types/token/token-input.js';

/**
 * Fixture structure for ERC-20 tokens
 * Contains both input (for create method) and dbResult (for mock return)
 */
interface TokenFixture {
  input: CreateTokenInput<'erc20'>;
  dbResult: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    tokenType: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    coingeckoId: string | null;
    marketCap: number | null;
    config: unknown;
  };
}

// ============================================================================
// ERC-20 Token Fixtures - Popular Mainnet Tokens
// ============================================================================

export const USDC_ETHEREUM: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    logoUrl: 'https://example.com/usdc.png',
    coingeckoId: 'usd-coin',
    marketCap: 28000000000,
    config: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chainId: 1,
    },
  },
  dbResult: {
    id: 'token_usdc_eth_001',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    tokenType: 'erc20',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    logoUrl: 'https://example.com/usdc.png',
    coingeckoId: 'usd-coin',
    marketCap: 28000000000,
    config: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chainId: 1,
    },
  },
};

export const WETH_ETHEREUM: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    logoUrl: 'https://example.com/weth.png',
    coingeckoId: 'weth',
    marketCap: 5000000000,
    config: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      chainId: 1,
    },
  },
  dbResult: {
    id: 'token_weth_eth_001',
    createdAt: new Date('2024-01-02T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    tokenType: 'erc20',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    logoUrl: 'https://example.com/weth.png',
    coingeckoId: 'weth',
    marketCap: 5000000000,
    config: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      chainId: 1,
    },
  },
};

export const DAI_ETHEREUM: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18,
    coingeckoId: 'dai',
    config: {
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      chainId: 1,
    },
  },
  dbResult: {
    id: 'token_dai_eth_001',
    createdAt: new Date('2024-01-03T00:00:00Z'),
    updatedAt: new Date('2024-01-03T00:00:00Z'),
    tokenType: 'erc20',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18,
    logoUrl: null,
    coingeckoId: 'dai',
    marketCap: null,
    config: {
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      chainId: 1,
    },
  },
};

// ============================================================================
// Multi-Chain Token Fixtures - Same token on different chains
// ============================================================================

export const USDC_ARBITRUM: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    config: {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      chainId: 42161,
    },
  },
  dbResult: {
    id: 'token_usdc_arb_001',
    createdAt: new Date('2024-01-04T00:00:00Z'),
    updatedAt: new Date('2024-01-04T00:00:00Z'),
    tokenType: 'erc20',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    logoUrl: null,
    coingeckoId: null,
    marketCap: null,
    config: {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      chainId: 42161,
    },
  },
};

export const USDC_BASE: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    config: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      chainId: 8453,
    },
  },
  dbResult: {
    id: 'token_usdc_base_001',
    createdAt: new Date('2024-01-05T00:00:00Z'),
    updatedAt: new Date('2024-01-05T00:00:00Z'),
    tokenType: 'erc20',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    logoUrl: null,
    coingeckoId: null,
    marketCap: null,
    config: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      chainId: 8453,
    },
  },
};

// ============================================================================
// Edge Case Fixtures
// ============================================================================

export const MINIMAL_ERC20: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'Minimal Token',
    symbol: 'MIN',
    decimals: 18,
    config: {
      address: '0x1111111111111111111111111111111111111111',
      chainId: 1,
    },
  },
  dbResult: {
    id: 'token_min_001',
    createdAt: new Date('2024-01-08T00:00:00Z'),
    updatedAt: new Date('2024-01-08T00:00:00Z'),
    tokenType: 'erc20',
    name: 'Minimal Token',
    symbol: 'MIN',
    decimals: 18,
    logoUrl: null,
    coingeckoId: null,
    marketCap: null,
    config: {
      address: '0x1111111111111111111111111111111111111111',
      chainId: 1,
    },
  },
};

export const SPECIAL_CHARS_TOKEN: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'Ether.fi Staked ETH',
    symbol: '$MEME',
    decimals: 18,
    config: {
      address: '0x2222222222222222222222222222222222222222',
      chainId: 1,
    },
  },
  dbResult: {
    id: 'token_special_001',
    createdAt: new Date('2024-01-09T00:00:00Z'),
    updatedAt: new Date('2024-01-09T00:00:00Z'),
    tokenType: 'erc20',
    name: 'Ether.fi Staked ETH',
    symbol: '$MEME',
    decimals: 18,
    logoUrl: null,
    coingeckoId: null,
    marketCap: null,
    config: {
      address: '0x2222222222222222222222222222222222222222',
      chainId: 1,
    },
  },
};

export const ZERO_MARKET_CAP_TOKEN: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'Dead Token',
    symbol: 'DEAD',
    decimals: 18,
    marketCap: 0,
    config: {
      address: '0x3333333333333333333333333333333333333333',
      chainId: 1,
    },
  },
  dbResult: {
    id: 'token_dead_001',
    createdAt: new Date('2024-01-10T00:00:00Z'),
    updatedAt: new Date('2024-01-10T00:00:00Z'),
    tokenType: 'erc20',
    name: 'Dead Token',
    symbol: 'DEAD',
    decimals: 18,
    logoUrl: null,
    coingeckoId: null,
    marketCap: 0,
    config: {
      address: '0x3333333333333333333333333333333333333333',
      chainId: 1,
    },
  },
};

export const HIGH_DECIMALS_TOKEN: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'High Decimals Token',
    symbol: 'HDT',
    decimals: 24,
    config: {
      address: '0x4444444444444444444444444444444444444444',
      chainId: 1,
    },
  },
  dbResult: {
    id: 'token_hdt_001',
    createdAt: new Date('2024-01-11T00:00:00Z'),
    updatedAt: new Date('2024-01-11T00:00:00Z'),
    tokenType: 'erc20',
    name: 'High Decimals Token',
    symbol: 'HDT',
    decimals: 24,
    logoUrl: null,
    coingeckoId: null,
    marketCap: null,
    config: {
      address: '0x4444444444444444444444444444444444444444',
      chainId: 1,
    },
  },
};

export const ZERO_DECIMALS_TOKEN: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'Zero Decimals Token',
    symbol: 'ZDT',
    decimals: 0,
    config: {
      address: '0x5555555555555555555555555555555555555555',
      chainId: 1,
    },
  },
  dbResult: {
    id: 'token_zdt_001',
    createdAt: new Date('2024-01-12T00:00:00Z'),
    updatedAt: new Date('2024-01-12T00:00:00Z'),
    tokenType: 'erc20',
    name: 'Zero Decimals Token',
    symbol: 'ZDT',
    decimals: 0,
    logoUrl: null,
    coingeckoId: null,
    marketCap: null,
    config: {
      address: '0x5555555555555555555555555555555555555555',
      chainId: 1,
    },
  },
};

// ============================================================================
// Token Discovery Fixtures
// ============================================================================

/**
 * Token for testing discovery flow
 * This token is "discovered" from on-chain data
 */
export const DISCOVERED_TOKEN: TokenFixture = {
  input: {
    tokenType: 'erc20',
    name: 'Discovered Token',
    symbol: 'DISC',
    decimals: 18,
    config: {
      address: '0x6666666666666666666666666666666666666666',
      chainId: 1,
    },
  },
  dbResult: {
    id: 'token_discovered_001',
    createdAt: new Date('2024-01-13T00:00:00Z'),
    updatedAt: new Date('2024-01-13T00:00:00Z'),
    tokenType: 'erc20',
    name: 'Discovered Token',
    symbol: 'DISC',
    decimals: 18,
    logoUrl: null,
    coingeckoId: null,
    marketCap: null,
    config: {
      address: '0x6666666666666666666666666666666666666666',
      chainId: 1,
    },
  },
};

/**
 * Non-compliant token for testing error cases
 * This contract doesn't implement ERC-20 metadata properly
 */
export const NON_COMPLIANT_TOKEN = {
  address: '0x7777777777777777777777777777777777777777',
  chainId: 1,
};

// ============================================================================
// Fixture Collections
// ============================================================================

export const ERC20_FIXTURES = {
  USDC_ETHEREUM,
  WETH_ETHEREUM,
  DAI_ETHEREUM,
  USDC_ARBITRUM,
  USDC_BASE,
} as const;

export const EDGE_CASE_FIXTURES = {
  MINIMAL_ERC20,
  SPECIAL_CHARS_TOKEN,
  ZERO_MARKET_CAP_TOKEN,
  HIGH_DECIMALS_TOKEN,
  ZERO_DECIMALS_TOKEN,
} as const;

export const DISCOVERY_FIXTURES = {
  DISCOVERED_TOKEN,
  NON_COMPLIANT_TOKEN,
} as const;

export const ALL_FIXTURES = {
  ...ERC20_FIXTURES,
  ...EDGE_CASE_FIXTURES,
  ...DISCOVERY_FIXTURES,
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a custom token fixture by overriding default values
 * Useful for creating ad-hoc test data
 */
export function createTokenFixture(
  overrides: Partial<CreateTokenInput<'erc20'>>
): TokenFixture {
  const base = USDC_ETHEREUM;
  const timestamp = new Date();

  return {
    input: {
      ...base.input,
      ...overrides,
      config: {
        ...base.input.config,
        ...(overrides.config || {}),
      },
    },
    dbResult: {
      ...base.dbResult,
      ...overrides,
      id: `token_custom_${Date.now()}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      config: {
        ...base.input.config,
        ...(overrides.config || {}),
      },
    },
  };
}
