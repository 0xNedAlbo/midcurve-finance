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
  type Chain,
} from 'wagmi/chains';
import { createConfig, createStorage, http, noopStorage } from 'wagmi';
import { defineChain } from 'viem';

// Get WalletConnect project ID from environment
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

if (!projectId) {
  console.warn('VITE_WALLETCONNECT_PROJECT_ID is not set');
}

// Check if local chain is enabled
const isLocalChainEnabled =
  import.meta.env.VITE_ENABLE_LOCAL_CHAIN === 'true';

// Local Anvil chain definition for development testing
const localAnvil = defineChain({
  id: 31337,
  name: 'Local Anvil Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_LOCAL_RPC_URL || 'http://localhost:8547'],
    },
  },
  testnet: true,
  // Multicall3 is available on the forked mainnet at the canonical address
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
});

// Production chains (always available)
const productionChains = [
  mainnet,
  arbitrum,
  base,
  bsc,
  polygon,
  optimism,
] as const;

// Define supported chains (include local only in development)
const chains: readonly [Chain, ...Chain[]] = isLocalChainEnabled
  ? ([...productionChains, localAnvil] as unknown as readonly [
      Chain,
      ...Chain[],
    ])
  : productionChains;

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

// Build transports configuration
const productionTransports = {
  [mainnet.id]: http(),
  [arbitrum.id]: http(),
  [base.id]: http(),
  [bsc.id]: http(),
  [polygon.id]: http(),
  [optimism.id]: http(),
};

// Add local chain transport if enabled
const transports = isLocalChainEnabled
  ? {
      ...productionTransports,
      [localAnvil.id]: http(
        import.meta.env.VITE_LOCAL_RPC_URL || 'http://localhost:8547'
      ),
    }
  : productionTransports;

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
  transports,
});
