import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  mainnet,
  arbitrum,
  base,
  bsc,
  polygon,
  optimism,
} from 'wagmi/chains';
import { createStorage } from 'wagmi';

// Get WalletConnect project ID from environment
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

if (!projectId) {
  console.warn('VITE_WALLETCONNECT_PROJECT_ID is not set');
}

export const wagmiConfig = getDefaultConfig({
  appName: 'Midcurve Finance',
  projectId,
  chains: [mainnet, arbitrum, base, bsc, polygon, optimism],
  ssr: false, // Disable SSR for Vite SPA
  storage: createStorage({
    storage: localStorage,
  }),
});
