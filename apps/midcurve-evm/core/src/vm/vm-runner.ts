import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type Chain,
  type Transport,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { semseeChain, DEFAULT_RPC_CONFIG } from './chain.js';
import type { VmRunnerConfig, CallResult, DeployResult, StoreAddresses } from './types.js';
import {
  CORE_PRIVATE_KEY,
  SYSTEM_REGISTRY_ADDRESS,
  GAS_LIMITS,
} from '../utils/addresses.js';
import { SYSTEM_REGISTRY_ABI } from '../abi/SystemRegistry.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('vm-runner');

// Type for wallet client with account set
type WalletClientWithAccount = ReturnType<typeof createWalletClient<Transport, Chain, PrivateKeyAccount>>;

/**
 * VmRunner provides a TypeScript interface to the SEMSEE Geth node.
 *
 * It handles:
 * - Contract deployments
 * - Callback execution as Core
 * - Store contract interactions
 * - Log extraction from transaction receipts
 */
export class VmRunner {
  private publicClient: PublicClient;
  private walletClient: WalletClientWithAccount;
  private storeAddresses: StoreAddresses | null = null;

  constructor(config: VmRunnerConfig = {}) {
    const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_CONFIG.httpUrl;
    const wsUrl = config.wsUrl ?? DEFAULT_RPC_CONFIG.wsUrl;

    // Create Core account from private key
    const coreAccount = privateKeyToAccount(CORE_PRIVATE_KEY);

    // Public client for reading state
    // Note: Using HTTP transport for reliability. WebSocket can be added later
    // if real-time event subscriptions are needed.
    this.publicClient = createPublicClient({
      chain: semseeChain,
      transport: http(rpcUrl),
    });

    // Wallet client for sending transactions as Core
    this.walletClient = createWalletClient({
      account: coreAccount,
      chain: semseeChain,
      transport: http(rpcUrl),
    });

    logger.info({ rpcUrl, wsUrl }, 'VmRunner created');
  }

  /**
   * Initialize the VmRunner by verifying the Geth node is running
   * and stores are deployed.
   */
  async initialize(): Promise<void> {
    logger.info('Initializing VmRunner...');

    // Check that Geth is running
    try {
      const chainId = await this.publicClient.getChainId();
      logger.info({ chainId }, 'Connected to Geth node');
    } catch (error) {
      throw new Error(
        `Failed to connect to Geth node. Is Docker running? Error: ${error}`
      );
    }

    // Verify SystemRegistry is deployed
    const registryCode = await this.publicClient.getCode({
      address: SYSTEM_REGISTRY_ADDRESS,
    });

    if (!registryCode || registryCode === '0x') {
      throw new Error(
        `SystemRegistry not deployed at ${SYSTEM_REGISTRY_ADDRESS}. ` +
          'Run docker compose up first.'
      );
    }

    logger.info('SystemRegistry found at genesis address');

    // Get store addresses from registry
    await this.loadStoreAddresses();
  }

  /**
   * Load store contract addresses from SystemRegistry
   */
  private async loadStoreAddresses(): Promise<void> {
    const [poolStore, positionStore, balanceStore] = await Promise.all([
      this.publicClient.readContract({
        address: SYSTEM_REGISTRY_ADDRESS,
        abi: SYSTEM_REGISTRY_ABI,
        functionName: 'poolStore',
      }) as Promise<Address>,
      this.publicClient.readContract({
        address: SYSTEM_REGISTRY_ADDRESS,
        abi: SYSTEM_REGISTRY_ABI,
        functionName: 'positionStore',
      }) as Promise<Address>,
      this.publicClient.readContract({
        address: SYSTEM_REGISTRY_ADDRESS,
        abi: SYSTEM_REGISTRY_ABI,
        functionName: 'balanceStore',
      }) as Promise<Address>,
    ]);

    const zeroAddress = '0x0000000000000000000000000000000000000000';

    if (poolStore === zeroAddress) {
      throw new Error(
        'Stores not deployed. Run: forge script DeployStores.s.sol --broadcast'
      );
    }

    this.storeAddresses = { poolStore, positionStore, balanceStore };
    logger.info(this.storeAddresses, 'Store addresses loaded');
  }

  /**
   * Get the store addresses (must call initialize first)
   */
  getStoreAddresses(): StoreAddresses {
    if (!this.storeAddresses) {
      throw new Error('VmRunner not initialized. Call initialize() first.');
    }
    return this.storeAddresses;
  }

  /**
   * Deploy a contract to the embedded EVM
   */
  async deploy(bytecode: Hex, constructorArgs?: Hex): Promise<DeployResult> {
    const fullBytecode = constructorArgs
      ? (`${bytecode}${constructorArgs.slice(2)}` as Hex)
      : bytecode;

    logger.debug({ bytecodeLength: fullBytecode.length }, 'Deploying contract');

    const hash = await this.walletClient.sendTransaction({
      data: fullBytecode,
      gas: GAS_LIMITS.CONSTRUCTOR,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
      throw new Error(`Contract deployment failed: ${hash}`);
    }

    if (!receipt.contractAddress) {
      throw new Error('No contract address in deployment receipt');
    }

    logger.info(
      { address: receipt.contractAddress, gasUsed: receipt.gasUsed },
      'Contract deployed'
    );

    return {
      address: receipt.contractAddress,
      gasUsed: receipt.gasUsed,
      txHash: hash,
    };
  }

  /**
   * Call a contract function as Core (0x0000...0001)
   *
   * This is used for:
   * - Delivering callbacks to strategies
   * - Updating store contracts
   */
  async callAsCore(
    to: Address,
    data: Hex,
    gasLimit: bigint = GAS_LIMITS.CALLBACK
  ): Promise<CallResult> {
    logger.debug({ to, dataLength: data.length, gasLimit }, 'Calling as Core');

    try {
      const hash = await this.walletClient.sendTransaction({
        to,
        data,
        gas: gasLimit,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      const result: CallResult = {
        success: receipt.status === 'success',
        gasUsed: receipt.gasUsed,
        logs: receipt.logs,
        txHash: hash,
      };

      if (!result.success) {
        result.error = 'Transaction reverted';
      }

      logger.debug(
        { success: result.success, gasUsed: result.gasUsed, logCount: result.logs.length },
        'Call completed'
      );

      return result;
    } catch (error) {
      logger.error({ error, to }, 'Call failed');

      return {
        success: false,
        gasUsed: 0n,
        logs: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Read contract state
   */
  async readContract<T>(
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args?: readonly unknown[]
  ): Promise<T> {
    return this.publicClient.readContract({
      address,
      abi,
      functionName,
      args,
    }) as Promise<T>;
  }

  /**
   * Get bytecode at an address
   */
  async getCode(address: Address): Promise<Hex | undefined> {
    return this.publicClient.getCode({ address });
  }

  /**
   * Watch for contract events
   */
  watchLogs(
    address: Address,
    onLogs: (logs: Log[]) => void
  ): () => void {
    return this.publicClient.watchEvent({
      address,
      onLogs,
    });
  }

  /**
   * Get the public client for advanced operations
   */
  getPublicClient(): PublicClient {
    return this.publicClient;
  }
}
