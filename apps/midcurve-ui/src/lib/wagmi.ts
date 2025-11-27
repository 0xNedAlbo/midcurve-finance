import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  mainnet,
  arbitrum,
  base,
  bsc,
  polygon,
  optimism,
} from 'wagmi/chains';
import { defineChain } from 'viem';
import { createStorage, noopStorage } from 'wagmi';

// Get WalletConnect project ID from environment
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

if (!projectId) {
  console.warn('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set');
}

/**
 * Hyperliquid L1 Chain Definition
 *
 * Hyperliquid requires chain ID 1337 for EIP-712 signature verification.
 * This is a "virtual" chain used only for signing Hyperliquid API requests.
 * The actual Hyperliquid exchange runs on its own L1, but we need to tell
 * wallets to use chainId 1337 when signing typed data.
 *
 * Note: This chain is only used for signing - no actual RPC calls are made to it.
 * The Hyperliquid SDK communicates with Hyperliquid's API endpoints directly.
 */
export const hyperliquidL1 = defineChain({
  id: 1337,
  name: 'Hyperliquid L1',
  nativeCurrency: {
    name: 'USD',
    symbol: 'USD',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      // Hyperliquid doesn't expose a standard EVM RPC - this is just for wallet compatibility
      // The SDK uses its own HTTP transport to communicate with Hyperliquid
      http: ['https://api.hyperliquid.xyz/evm'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Hyperliquid Explorer',
      url: 'https://app.hyperliquid.xyz',
    },
  },
});

export const config = getDefaultConfig({
  appName: 'Midcurve Finance',
  projectId,
  chains: [mainnet, arbitrum, base, bsc, polygon, optimism, hyperliquidL1],
  ssr: true, // Enable server-side rendering support
  storage: createStorage({
    storage: typeof window !== 'undefined' ? window.localStorage : noopStorage,
  }),
});
