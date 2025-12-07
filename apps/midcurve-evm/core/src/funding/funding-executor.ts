import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type Chain,
  type Account,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, base, optimism, polygon, bsc } from 'viem/chains';
import type pino from 'pino';
import { ERC20_ABI } from '../abi/Funding.js';
import {
  type Erc20WithdrawParams,
  type EthWithdrawParams,
  type FundingResult,
} from './types.js';

/**
 * Chain client pair for a specific chain
 */
interface ChainClients {
  public: ReturnType<typeof createPublicClient>;
  wallet: ReturnType<typeof createWalletClient<Transport, Chain, Account>>;
}

/**
 * Supported chain configuration
 */
const SUPPORTED_CHAINS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  10: optimism,
  137: polygon,
  56: bsc,
};

/**
 * FundingExecutor executes funding operations on external chains.
 *
 * Responsibilities:
 * - Execute ERC-20 token transfers (withdrawals)
 * - Execute native ETH transfers (withdrawals)
 * - Poll ETH balances for balance updates
 * - Manage connections to multiple chains
 */
export class FundingExecutor {
  private chainClients: Map<number, ChainClients> = new Map();
  private automationWalletAddress: Address;

  constructor(
    private automationWalletKey: Hex,
    private chainRpcUrls: Map<number, string>,
    private logger: pino.Logger
  ) {
    const account = privateKeyToAccount(automationWalletKey);
    this.automationWalletAddress = account.address;

    this.initializeChainClients();
  }

  /**
   * Initialize clients for all configured chains
   */
  private initializeChainClients(): void {
    for (const [chainId, rpcUrl] of this.chainRpcUrls) {
      const chain = SUPPORTED_CHAINS[chainId];
      if (!chain) {
        this.logger.warn({ chainId }, 'Unsupported chain ID, skipping');
        continue;
      }

      try {
        const account = privateKeyToAccount(this.automationWalletKey);

        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });

        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(rpcUrl),
        });

        this.chainClients.set(chainId, {
          public: publicClient,
          wallet: walletClient,
        });

        this.logger.info(
          { chainId, chainName: chain.name },
          'Initialized chain client'
        );
      } catch (error) {
        this.logger.error(
          { chainId, error },
          'Failed to initialize chain client'
        );
      }
    }
  }

  /**
   * Get clients for a specific chain
   */
  private getChainClients(chainId: number): ChainClients {
    const clients = this.chainClients.get(chainId);
    if (!clients) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    return clients;
  }

  /**
   * Execute ERC-20 token withdrawal
   */
  async executeErc20Withdraw(
    requestId: Hex,
    params: Erc20WithdrawParams,
    recipient: Address
  ): Promise<FundingResult> {
    const chainId = Number(params.chainId);

    try {
      const clients = this.getChainClients(chainId);

      this.logger.info(
        {
          requestId,
          chainId,
          token: params.token,
          amount: params.amount.toString(),
          recipient,
        },
        'Executing ERC-20 withdrawal'
      );

      // Execute the transfer
      const hash = await clients.wallet.writeContract({
        address: params.token,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [recipient, params.amount],
      });

      this.logger.info(
        { requestId, txHash: hash },
        'ERC-20 withdrawal transaction sent'
      );

      // Wait for confirmation
      const receipt = await clients.public.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        this.logger.info(
          { requestId, txHash: hash, blockNumber: receipt.blockNumber },
          'ERC-20 withdrawal confirmed'
        );

        return {
          requestId,
          success: true,
          txHash: hash,
        };
      } else {
        this.logger.error(
          { requestId, txHash: hash },
          'ERC-20 withdrawal transaction failed'
        );

        return {
          requestId,
          success: false,
          txHash: hash,
          errorMessage: 'Transaction reverted',
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        { requestId, chainId, error: errorMessage },
        'ERC-20 withdrawal execution failed'
      );

      return {
        requestId,
        success: false,
        errorMessage,
      };
    }
  }

  /**
   * Execute native ETH withdrawal
   */
  async executeEthWithdraw(
    requestId: Hex,
    params: EthWithdrawParams,
    recipient: Address
  ): Promise<FundingResult> {
    const chainId = Number(params.chainId);

    try {
      const clients = this.getChainClients(chainId);

      this.logger.info(
        {
          requestId,
          chainId,
          amount: params.amount.toString(),
          recipient,
        },
        'Executing ETH withdrawal'
      );

      // Execute the transfer
      const hash = await clients.wallet.sendTransaction({
        to: recipient,
        value: params.amount,
      });

      this.logger.info(
        { requestId, txHash: hash },
        'ETH withdrawal transaction sent'
      );

      // Wait for confirmation
      const receipt = await clients.public.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        this.logger.info(
          { requestId, txHash: hash, blockNumber: receipt.blockNumber },
          'ETH withdrawal confirmed'
        );

        return {
          requestId,
          success: true,
          txHash: hash,
        };
      } else {
        this.logger.error(
          { requestId, txHash: hash },
          'ETH withdrawal transaction failed'
        );

        return {
          requestId,
          success: false,
          txHash: hash,
          errorMessage: 'Transaction reverted',
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        { requestId, chainId, error: errorMessage },
        'ETH withdrawal execution failed'
      );

      return {
        requestId,
        success: false,
        errorMessage,
      };
    }
  }

  /**
   * Get ETH balance for the automation wallet on a specific chain
   */
  async getEthBalance(chainId: bigint): Promise<bigint> {
    const chainIdNum = Number(chainId);
    const clients = this.getChainClients(chainIdNum);

    const balance = await clients.public.getBalance({
      address: this.automationWalletAddress,
    });

    this.logger.debug(
      {
        chainId: chainIdNum,
        balance: balance.toString(),
      },
      'Polled ETH balance'
    );

    return balance;
  }

  /**
   * Get ERC-20 token balance for the automation wallet on a specific chain
   */
  async getErc20Balance(chainId: bigint, token: Address): Promise<bigint> {
    const chainIdNum = Number(chainId);
    const clients = this.getChainClients(chainIdNum);

    const balance = await clients.public.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [this.automationWalletAddress],
    });

    this.logger.debug(
      {
        chainId: chainIdNum,
        token,
        balance: (balance as bigint).toString(),
      },
      'Polled ERC-20 balance'
    );

    return balance as bigint;
  }

  /**
   * Get the automation wallet address
   */
  getAutomationWalletAddress(): Address {
    return this.automationWalletAddress;
  }

  /**
   * Check if a chain is configured
   */
  isChainConfigured(chainId: number): boolean {
    return this.chainClients.has(chainId);
  }

  /**
   * Get all configured chain IDs
   */
  getConfiguredChains(): number[] {
    return Array.from(this.chainClients.keys());
  }
}
