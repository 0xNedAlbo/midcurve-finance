import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  rabbyWallet,
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets';
import {
  mainnet,
  arbitrum,
  base,
  bsc,
  polygon,
  optimism,
} from 'wagmi/chains';
import { createConfig, createStorage, http, noopStorage } from 'wagmi';

// Get WalletConnect project ID from environment
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

if (!projectId) {
  console.warn('VITE_WALLETCONNECT_PROJECT_ID is not set');
}

// Define supported chains
const chains = [mainnet, arbitrum, base, bsc, polygon, optimism] as const;

// Explicitly configure wallets - this ensures Rabby is properly detected
// and can trigger its unlock dialog when locked
const connectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      wallets: [
        rabbyWallet,
        metaMaskWallet,
        coinbaseWallet,
        walletConnectWallet,
      ],
    },
    {
      groupName: 'Other',
      wallets: [injectedWallet],
    },
  ],
  {
    appName: 'Midcurve Finance',
    projectId,
  }
);

export const wagmiConfig = createConfig({
  chains,
  connectors,
  // Enable SSR mode to delay hydration - this gives wallet extensions time to initialize
  // before wagmi tries to reconnect. Prevents "getChainId is not a function" errors
  // when wallet is locked or not ready.
  ssr: true,
  storage: createStorage({
    storage: typeof window !== 'undefined' ? window.localStorage : noopStorage,
  }),
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    [bsc.id]: http(),
    [polygon.id]: http(),
    [optimism.id]: http(),
  },
});
