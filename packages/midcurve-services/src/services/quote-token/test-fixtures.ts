/**
 * Test Fixtures for Quote Token Service
 *
 * Reusable test data for consistent testing across all quote token service tests.
 */

import type { UniswapV3QuoteTokenInput } from '../types/quote-token/quote-token-input.js';
import type { UniswapV3QuoteTokenResult } from '@midcurve/shared';
import { SupportedChainId } from '../../config/evm.js';

/**
 * Test user IDs
 */
export const TEST_USER_IDS = {
  ALICE: 'user_alice_001',
  BOB: 'user_bob_002',
  CHARLIE: 'user_charlie_003',
} as const;

/**
 * Well-known token addresses (EIP-55 checksum format)
 */
export const TOKENS = {
  // Ethereum Mainnet
  ETHEREUM: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  },

  // Arbitrum One
  ARBITRUM: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Native USDC
    USDC_E: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // Bridged USDC.e
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  },

  // Base
  BASE: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    WETH: '0x4200000000000000000000000000000000000006',
    DEGEN: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
  },
} as const;

/**
 * Test scenario: WETH/USDC on Ethereum
 * Expected: USDC is quote (stablecoin priority)
 */
export const SCENARIO_WETH_USDC_ETH: {
  input: UniswapV3QuoteTokenInput;
  expected: Omit<UniswapV3QuoteTokenResult, 'quoteTokenSymbol' | 'baseTokenSymbol'>;
} = {
  input: {
    userId: TEST_USER_IDS.ALICE,
    chainId: SupportedChainId.ETHEREUM,
    token0Address: TOKENS.ETHEREUM.WETH,
    token1Address: TOKENS.ETHEREUM.USDC,
  },
  expected: {
    isToken0Quote: false,
    quoteTokenId: TOKENS.ETHEREUM.USDC,
    baseTokenId: TOKENS.ETHEREUM.WETH,
    matchedBy: 'default',
    protocol: 'uniswapv3',
  },
};

/**
 * Test scenario: USDC/LINK on Ethereum
 * Expected: USDC is quote (stablecoin priority)
 */
export const SCENARIO_USDC_LINK_ETH: {
  input: UniswapV3QuoteTokenInput;
  expected: Omit<UniswapV3QuoteTokenResult, 'quoteTokenSymbol' | 'baseTokenSymbol'>;
} = {
  input: {
    userId: TEST_USER_IDS.ALICE,
    chainId: SupportedChainId.ETHEREUM,
    token0Address: TOKENS.ETHEREUM.USDC,
    token1Address: TOKENS.ETHEREUM.LINK,
  },
  expected: {
    isToken0Quote: true,
    quoteTokenId: TOKENS.ETHEREUM.USDC,
    baseTokenId: TOKENS.ETHEREUM.LINK,
    matchedBy: 'default',
    protocol: 'uniswapv3',
  },
};

/**
 * Test scenario: LINK/WETH on Ethereum
 * Expected: WETH is quote (wrapped native priority)
 */
export const SCENARIO_LINK_WETH_ETH: {
  input: UniswapV3QuoteTokenInput;
  expected: Omit<UniswapV3QuoteTokenResult, 'quoteTokenSymbol' | 'baseTokenSymbol'>;
} = {
  input: {
    userId: TEST_USER_IDS.ALICE,
    chainId: SupportedChainId.ETHEREUM,
    token0Address: TOKENS.ETHEREUM.LINK,
    token1Address: TOKENS.ETHEREUM.WETH,
  },
  expected: {
    isToken0Quote: false,
    quoteTokenId: TOKENS.ETHEREUM.WETH,
    baseTokenId: TOKENS.ETHEREUM.LINK,
    matchedBy: 'default',
    protocol: 'uniswapv3',
  },
};

/**
 * Test scenario: UNI/LINK on Ethereum (no defaults match)
 * Expected: token0 (UNI) is quote (fallback)
 */
export const SCENARIO_UNI_LINK_ETH: {
  input: UniswapV3QuoteTokenInput;
  expected: Omit<UniswapV3QuoteTokenResult, 'quoteTokenSymbol' | 'baseTokenSymbol'>;
} = {
  input: {
    userId: TEST_USER_IDS.ALICE,
    chainId: SupportedChainId.ETHEREUM,
    token0Address: TOKENS.ETHEREUM.UNI,
    token1Address: TOKENS.ETHEREUM.LINK,
  },
  expected: {
    isToken0Quote: true,
    quoteTokenId: TOKENS.ETHEREUM.UNI,
    baseTokenId: TOKENS.ETHEREUM.LINK,
    matchedBy: 'fallback',
    protocol: 'uniswapv3',
  },
};

/**
 * Test scenario: WETH/ARB on Arbitrum
 * Expected: WETH is quote (wrapped native priority)
 */
export const SCENARIO_WETH_ARB_ARBITRUM: {
  input: UniswapV3QuoteTokenInput;
  expected: Omit<UniswapV3QuoteTokenResult, 'quoteTokenSymbol' | 'baseTokenSymbol'>;
} = {
  input: {
    userId: TEST_USER_IDS.ALICE,
    chainId: SupportedChainId.ARBITRUM,
    token0Address: TOKENS.ARBITRUM.WETH,
    token1Address: TOKENS.ARBITRUM.ARB,
  },
  expected: {
    isToken0Quote: true,
    quoteTokenId: TOKENS.ARBITRUM.WETH,
    baseTokenId: TOKENS.ARBITRUM.ARB,
    matchedBy: 'default',
    protocol: 'uniswapv3',
  },
};

/**
 * Test scenario: USDC/USDT on Ethereum (both stablecoins)
 * Expected: USDC is quote (first in default list)
 */
export const SCENARIO_USDC_USDT_ETH: {
  input: UniswapV3QuoteTokenInput;
  expected: Omit<UniswapV3QuoteTokenResult, 'quoteTokenSymbol' | 'baseTokenSymbol'>;
} = {
  input: {
    userId: TEST_USER_IDS.ALICE,
    chainId: SupportedChainId.ETHEREUM,
    token0Address: TOKENS.ETHEREUM.USDC,
    token1Address: TOKENS.ETHEREUM.USDT,
  },
  expected: {
    isToken0Quote: true,
    quoteTokenId: TOKENS.ETHEREUM.USDC,
    baseTokenId: TOKENS.ETHEREUM.USDT,
    matchedBy: 'default',
    protocol: 'uniswapv3',
  },
};

/**
 * Test scenario: USDT/DAI on Ethereum (both stablecoins, reversed)
 * Expected: USDT is quote (first in default list)
 */
export const SCENARIO_USDT_DAI_ETH: {
  input: UniswapV3QuoteTokenInput;
  expected: Omit<UniswapV3QuoteTokenResult, 'quoteTokenSymbol' | 'baseTokenSymbol'>;
} = {
  input: {
    userId: TEST_USER_IDS.ALICE,
    chainId: SupportedChainId.ETHEREUM,
    token0Address: TOKENS.ETHEREUM.USDT,
    token1Address: TOKENS.ETHEREUM.DAI,
  },
  expected: {
    isToken0Quote: true,
    quoteTokenId: TOKENS.ETHEREUM.USDT,
    baseTokenId: TOKENS.ETHEREUM.DAI,
    matchedBy: 'default',
    protocol: 'uniswapv3',
  },
};

/**
 * Test scenario: User preference overrides default
 * User prefers WETH over stablecoins
 */
export const SCENARIO_USER_PREFERS_WETH: {
  input: UniswapV3QuoteTokenInput;
  userPreferences: string[];
  expected: Omit<UniswapV3QuoteTokenResult, 'quoteTokenSymbol' | 'baseTokenSymbol'>;
} = {
  input: {
    userId: TEST_USER_IDS.BOB,
    chainId: SupportedChainId.ETHEREUM,
    token0Address: TOKENS.ETHEREUM.WETH,
    token1Address: TOKENS.ETHEREUM.USDC,
  },
  userPreferences: [TOKENS.ETHEREUM.WETH], // User prefers WETH
  expected: {
    isToken0Quote: true,
    quoteTokenId: TOKENS.ETHEREUM.WETH,
    baseTokenId: TOKENS.ETHEREUM.USDC,
    matchedBy: 'user_preference',
    protocol: 'uniswapv3',
  },
};

/**
 * Test scenario: Case-insensitive address matching
 * Lowercase input should match checksummed address
 */
export const SCENARIO_CASE_INSENSITIVE: {
  input: UniswapV3QuoteTokenInput;
  expected: Omit<UniswapV3QuoteTokenResult, 'quoteTokenSymbol' | 'baseTokenSymbol'>;
} = {
  input: {
    userId: TEST_USER_IDS.ALICE,
    chainId: SupportedChainId.ETHEREUM,
    token0Address: TOKENS.ETHEREUM.WETH.toLowerCase(), // lowercase
    token1Address: TOKENS.ETHEREUM.USDC.toLowerCase(), // lowercase
  },
  expected: {
    isToken0Quote: false,
    quoteTokenId: TOKENS.ETHEREUM.USDC,
    baseTokenId: TOKENS.ETHEREUM.WETH,
    matchedBy: 'default',
    protocol: 'uniswapv3',
  },
};

/**
 * Helper: Create a quote token input with custom parameters
 */
export function createQuoteTokenInput(
  overrides: Partial<UniswapV3QuoteTokenInput>
): UniswapV3QuoteTokenInput {
  return {
    userId: TEST_USER_IDS.ALICE,
    chainId: SupportedChainId.ETHEREUM,
    token0Address: TOKENS.ETHEREUM.WETH,
    token1Address: TOKENS.ETHEREUM.USDC,
    ...overrides,
  };
}
