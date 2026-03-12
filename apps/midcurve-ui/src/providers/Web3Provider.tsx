import { useMemo, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { createWagmiConfig } from '../lib/wagmi-config';
import { useConfig } from './ConfigProvider';
import '@rainbow-me/rainbowkit/styles.css';

interface Web3ProviderProps {
  children: ReactNode;
}

export function Web3Provider({ children }: Web3ProviderProps) {
  const { walletconnectProjectId } = useConfig();

  const config = useMemo(
    () => createWagmiConfig(walletconnectProjectId ?? ''),
    [walletconnectProjectId],
  );

  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider>{children}</RainbowKitProvider>
    </WagmiProvider>
  );
}
