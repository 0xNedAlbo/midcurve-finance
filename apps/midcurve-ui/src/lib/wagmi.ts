import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  mainnet,
  arbitrum,
  base,
  bsc,
  polygon,
  optimism,
} from 'wagmi/chains';

// Get WalletConnect project ID from environment
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

if (!projectId) {
  console.warn('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set');
}

export const config = getDefaultConfig({
  appName: 'Midcurve Finance',
  projectId,
  chains: [mainnet, arbitrum, base, bsc, polygon, optimism],
  ssr: true, // Enable server-side rendering support
});
