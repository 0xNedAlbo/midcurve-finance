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
  sepolia,
  type Chain,
} from 'wagmi/chains';
import { createConfig, createStorage, http, noopStorage, type Config, type CreateConnectorFn } from 'wagmi';
import { defineChain } from 'viem';
import { burnerConnector } from './wagmi/burner-connector';

// Check if development chains are enabled
const isDevChainsEnabled =
  import.meta.env.VITE_ENABLE_DEV_CHAINS === 'true' ||
  import.meta.env.VITE_ENABLE_LOCAL_CHAIN === 'true';

// Local Anvil chain definition for development testing
const localAnvil = defineChain({
  id: 31337,
  name: 'Local Anvil Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_RPC_URL_LOCAL || 'http://localhost:8545'],
    },
  },
  testnet: true,
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
] as const;

// Define supported chains (include dev chains only in development)
const chains: readonly [Chain, ...Chain[]] = isDevChainsEnabled
  ? ([...productionChains, sepolia, localAnvil] as unknown as readonly [
      Chain,
      ...Chain[],
    ])
  : productionChains;

// Build transports configuration
const productionTransports = {
  [mainnet.id]: http(),
  [arbitrum.id]: http(),
  [base.id]: http(),
};

const transports = isDevChainsEnabled
  ? {
      ...productionTransports,
      [sepolia.id]: http(),
      [localAnvil.id]: http(
        import.meta.env.VITE_RPC_URL_LOCAL || 'http://localhost:8545'
      ),
    }
  : productionTransports;

/**
 * Create a wagmi config with the given WalletConnect project ID.
 * Called by Web3Provider once the project ID is known from the config API.
 */
// Dev-only burner wallet: auto-connects with a local PrivateKeyAccount so that
// SIWE and tx signing work headless (no MetaMask popup). Gated behind
// import.meta.env.DEV so Vite's dead-code elimination strips the branch —
// and the VITE_BURNER_PRIVATE_KEY import — from production bundles.
const isBurnerEnabled =
  import.meta.env.DEV &&
  import.meta.env.VITE_ENABLE_BURNER_WALLET === 'true';

function buildBurnerConnectors(): CreateConnectorFn[] {
  if (!isBurnerEnabled) return [];
  const key = import.meta.env.VITE_BURNER_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      'VITE_BURNER_PRIVATE_KEY is required when VITE_ENABLE_BURNER_WALLET=true'
    );
  }
  return [burnerConnector(key as `0x${string}`)];
}

export function createWagmiConfig(projectId: string): Config {
  const rainbowKitConnectors = connectorsForWallets(
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

  const connectors: CreateConnectorFn[] = [
    ...buildBurnerConnectors(),
    ...rainbowKitConnectors,
  ];

  return createConfig({
    chains,
    connectors,
    ssr: true,
    storage: createStorage({
      storage: typeof window !== 'undefined' ? window.localStorage : noopStorage,
    }),
    transports,
  });
}
