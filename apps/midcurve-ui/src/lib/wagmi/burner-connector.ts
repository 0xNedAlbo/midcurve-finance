import { createConnector } from 'wagmi';
import {
  createWalletClient,
  http,
  hexToBigInt,
  hexToNumber,
  toHex,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

type BurnerProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
};

type BurnerProperties = {
  connect<withCapabilities extends boolean = false>(parameters?: {
    chainId?: number | undefined;
    isReconnecting?: boolean | undefined;
    withCapabilities?: withCapabilities | boolean | undefined;
  }): Promise<{
    accounts: withCapabilities extends true
      ? readonly { address: Address; capabilities: Record<string, unknown> }[]
      : readonly Address[];
    chainId: number;
  }>;
};

export function burnerConnector(privateKey: `0x${string}`) {
  const account: PrivateKeyAccount = privateKeyToAccount(privateKey);

  return createConnector<BurnerProvider, BurnerProperties>((config) => {
    let currentChain: Chain | undefined;
    let walletClient: WalletClient | undefined;

    const pickInitialChain = (): Chain => {
      const testnet = config.chains.find((c) => c.testnet === true);
      return testnet ?? config.chains[0];
    };

    const ensureChain = (): Chain => {
      if (!currentChain) currentChain = pickInitialChain();
      return currentChain;
    };

    const ensureWalletClient = (): WalletClient => {
      const chain = ensureChain();
      if (!walletClient || walletClient.chain?.id !== chain.id) {
        walletClient = createWalletClient({
          account,
          chain,
          transport: http(),
        });
      }
      return walletClient;
    };

    const provider: BurnerProvider = {
      request: async ({ method, params }) => {
        const p = (params ?? []) as unknown[];

        switch (method) {
          case 'eth_accounts':
          case 'eth_requestAccounts':
            return [account.address];

          case 'eth_chainId':
            return toHex(ensureChain().id);

          case 'personal_sign': {
            const [messageHex, address] = p as [Hex, Address];
            if (address.toLowerCase() !== account.address.toLowerCase()) {
              throw new Error(
                `burner: personal_sign address mismatch (got ${address}, expected ${account.address})`
              );
            }
            return account.signMessage({ message: { raw: messageHex } });
          }

          case 'eth_sign': {
            const [, messageHex] = p as [Address, Hex];
            return account.signMessage({ message: { raw: messageHex } });
          }

          case 'eth_signTypedData_v4': {
            const [, typedDataArg] = p as [Address, string | object];
            const typedData =
              typeof typedDataArg === 'string'
                ? JSON.parse(typedDataArg)
                : typedDataArg;
            return account.signTypedData(typedData);
          }

          case 'eth_sendTransaction': {
            const client = ensureWalletClient();
            const tx = p[0] as {
              to?: Address;
              data?: Hex;
              value?: Hex;
              gas?: Hex;
              gasPrice?: Hex;
              maxFeePerGas?: Hex;
              maxPriorityFeePerGas?: Hex;
              nonce?: Hex;
            };
            const hash: Hash = await client.sendTransaction({
              account,
              chain: ensureChain(),
              to: tx.to,
              data: tx.data,
              value: tx.value ? hexToBigInt(tx.value) : undefined,
              gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
              maxFeePerGas: tx.maxFeePerGas
                ? hexToBigInt(tx.maxFeePerGas)
                : undefined,
              maxPriorityFeePerGas: tx.maxPriorityFeePerGas
                ? hexToBigInt(tx.maxPriorityFeePerGas)
                : undefined,
              gasPrice: tx.gasPrice ? hexToBigInt(tx.gasPrice) : undefined,
              nonce: tx.nonce ? hexToNumber(tx.nonce) : undefined,
            } as Parameters<WalletClient['sendTransaction']>[0]);
            return hash;
          }

          case 'wallet_switchEthereumChain': {
            const [{ chainId: hex }] = p as [{ chainId: Hex }];
            const id = hexToNumber(hex);
            const chain = config.chains.find((c) => c.id === id);
            if (!chain) throw new Error(`burner: chain ${id} not configured`);
            currentChain = chain;
            walletClient = undefined;
            config.emitter.emit('change', { chainId: id });
            return null;
          }

          default: {
            const client = ensureWalletClient();
            return client.request({ method, params } as Parameters<
              WalletClient['request']
            >[0]);
          }
        }
      },
      on: () => {},
      removeListener: () => {},
    };

    return {
      id: 'midcurve-dev-burner',
      name: 'Dev Burner Wallet',
      type: 'burner',

      async connect({ chainId, withCapabilities } = {}) {
        if (chainId) {
          const chain = config.chains.find((c) => c.id === chainId);
          if (chain) currentChain = chain;
        }
        const chain = ensureChain();
        return {
          accounts: (withCapabilities
            ? [{ address: account.address, capabilities: {} }]
            : [account.address]) as never,
          chainId: chain.id,
        };
      },

      async disconnect() {
        walletClient = undefined;
      },

      async getAccounts() {
        return [account.address];
      },

      async getChainId() {
        return ensureChain().id;
      },

      async getProvider() {
        return provider;
      },

      async isAuthorized() {
        return true;
      },

      async switchChain({ chainId }) {
        const chain = config.chains.find((c) => c.id === chainId);
        if (!chain) {
          throw new Error(`burner: chain ${chainId} not configured in wagmi`);
        }
        currentChain = chain;
        walletClient = undefined;
        config.emitter.emit('change', { chainId });
        return chain;
      },

      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {},
    };
  });
}
