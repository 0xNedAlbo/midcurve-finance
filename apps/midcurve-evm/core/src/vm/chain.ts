import { defineChain } from 'viem';

/**
 * Custom chain definition for the SEMSEE embedded EVM
 *
 * This chain runs in Docker via Geth with:
 * - Clique PoA consensus (instant blocks)
 * - SystemRegistry deployed at genesis (0x1000)
 * - Pre-funded Core account (0x1)
 */
export const semseeChain = defineChain({
  id: 31337,
  name: 'SEMSEE',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['http://localhost:8545'],
      webSocket: ['ws://localhost:8546'],
    },
  },
  blockExplorers: undefined, // No block explorer for embedded chain
  testnet: true,
});

/**
 * Default RPC configuration
 */
export const DEFAULT_RPC_CONFIG = {
  httpUrl: 'http://localhost:8545',
  wsUrl: 'ws://localhost:8546',
} as const;
