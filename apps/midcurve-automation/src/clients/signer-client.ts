/**
 * Signer Client
 *
 * HTTP client for communicating with the midcurve-signer service.
 * Handles signing of deployment and execution transactions.
 *
 * Note: registerOrder and cancelOrder are owner-only functions that users
 * sign with their own EOA wallet. Only executeOrder (operator-only) needs
 * to be signed by the automation wallet via this client.
 *
 * Gas estimation is done here before calling the signer, keeping the
 * signer isolated from external RPC endpoints for security.
 */

import { encodeFunctionData, type Address } from 'viem';
import { getSignerConfig } from '../lib/config';
import { automationLogger } from '../lib/logger';
import { getPublicClient, type SupportedChainId } from '../lib/evm';

const log = automationLogger.child({ component: 'SignerClient' });

// =============================================================================
// Types
// =============================================================================

export interface SignedTransaction {
  signedTransaction: string;
  predictedAddress?: string;
  nonce: number;
  txHash: string;
  from: string;
}

/**
 * Swap parameters for executeOrder with post-close swap
 *
 * When augustus is the zero address (0x0000...0000), the contract executes a direct
 * pool swap (fallback mode) instead of routing through Paraswap. In this mode,
 * swapCalldata and deadline are ignored, and minAmountOut provides slippage protection.
 */
export interface SwapParamsInput {
  augustus: string;       // Augustus swapper address, or 0x0 for direct pool swap
  swapCalldata: string;   // Hex-encoded calldata (ignored when augustus == 0x0)
  deadline: number;       // Unix timestamp or 0 for no deadline
  minAmountOut: string;   // Minimum output amount (slippage protection)
}

export interface ExecuteOrderParams {
  userId: string;
  chainId: number;
  contractAddress: string;
  nftId: bigint;
  triggerMode: number; // 0=LOWER, 1=UPPER
  feeRecipient: string;
  feeBps: number;
  // Operator address for gas estimation
  operatorAddress: string;
  // Nonce for transaction (caller fetches from chain)
  nonce: number;
  // Optional swap params for post-close swap
  swapParams?: SwapParamsInput;
}

// =============================================================================
// Contract ABI (minimal for gas estimation)
// =============================================================================

const POSITION_CLOSER_ABI = [
  {
    type: 'function',
    name: 'executeOrder',
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'triggerMode', type: 'uint8' },
      { name: 'feeRecipient', type: 'address' },
      { name: 'feeBps', type: 'uint16' },
      {
        name: 'swapParams',
        type: 'tuple',
        components: [
          { name: 'augustus', type: 'address' },
          { name: 'swapCalldata', type: 'bytes' },
          { name: 'deadline', type: 'uint256' },
          { name: 'minAmountOut', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// Empty swap params (no swap)
const EMPTY_SWAP_PARAMS = {
  augustus: '0x0000000000000000000000000000000000000000' as Address,
  swapCalldata: '0x' as `0x${string}`,
  deadline: 0n,
  minAmountOut: 0n,
} as const;

// =============================================================================
// Client
// =============================================================================

class SignerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    const config = getSignerConfig();
    this.baseUrl = config.url;
    this.apiKey = config.apiKey;
  }

  /**
   * Make an authenticated request to the signer service
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    log.debug({ method, path, msg: 'Making signer request' });

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error({
        method,
        path,
        status: response.status,
        error: errorBody,
        msg: 'Signer request failed',
      });
      throw new Error(`Signer request failed: ${response.status} ${errorBody}`);
    }

    const data = await response.json();

    if (!data.success) {
      log.error({
        method,
        path,
        error: data.error,
        msg: 'Signer returned error',
      });
      throw new Error(`Signer error: ${data.error?.message || 'Unknown error'}`);
    }

    return data.data as T;
  }

  /**
   * Sign an executeOrder transaction
   *
   * Gas estimation is performed here before calling the signer.
   * This keeps the signer isolated from external RPC endpoints.
   *
   * The caller must fetch the on-chain nonce and pass it to this method.
   * The signer service is stateless and does not manage nonces.
   */
  async signExecuteOrder(params: ExecuteOrderParams): Promise<SignedTransaction> {
    const { userId, chainId, contractAddress, nftId, triggerMode, feeRecipient, feeBps, operatorAddress, nonce, swapParams } =
      params;

    log.info({
      userId,
      chainId,
      contractAddress,
      nftId: nftId.toString(),
      triggerMode,
      explicitNonce: nonce,
      hasSwap: !!swapParams,
      msg: 'Estimating gas for order execution',
    });

    // Estimate gas locally (automation service has RPC access)
    const publicClient = getPublicClient(chainId as SupportedChainId);

    // Build swap params tuple (use empty params if no swap)
    const swapParamsTuple = swapParams
      ? {
          augustus: swapParams.augustus as Address,
          swapCalldata: swapParams.swapCalldata as `0x${string}`,
          deadline: BigInt(swapParams.deadline),
          minAmountOut: BigInt(swapParams.minAmountOut),
        }
      : EMPTY_SWAP_PARAMS;

    const callData = encodeFunctionData({
      abi: POSITION_CLOSER_ABI,
      functionName: 'executeOrder',
      args: [nftId, triggerMode, feeRecipient as Address, feeBps, swapParamsTuple],
    });

    let gasLimit: bigint;
    let gasPrice: bigint;

    try {
      // Get current gas price and estimate gas
      // Add buffers to both: 20% for gasLimit, 20% for gasPrice (Arbitrum base fee can fluctuate)
      [gasPrice, gasLimit] = await Promise.all([
        publicClient.getGasPrice().then((price) => (price * 120n) / 100n), // 20% buffer for base fee fluctuation
        publicClient.estimateGas({
          account: operatorAddress as Address,
          to: contractAddress as Address,
          data: callData,
        }).then((estimate) => (estimate * 120n) / 100n), // 20% buffer
      ]);
    } catch (error) {
      log.warn({
        userId,
        chainId,
        contractAddress,
        nftId: nftId.toString(),
        triggerMode,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Gas estimation failed, using fallback values',
      });
      // Fallback values if estimation fails (with 20% buffer on gas price)
      gasPrice = await publicClient.getGasPrice().then((price) => (price * 120n) / 100n);
      gasLimit = 500_000n;
    }

    log.info({
      userId,
      chainId,
      contractAddress,
      nftId: nftId.toString(),
      triggerMode,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      msg: 'Signing order execution',
    });

    // Call signer with gas params and nonce (nonce always required, fetched from chain by caller)
    return this.request<SignedTransaction>('POST', '/api/sign/automation/uniswapv3/position-closer/execute-order', {
      userId,
      chainId,
      contractAddress,
      nftId: nftId.toString(),
      triggerMode,
      feeRecipient,
      feeBps,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      nonce,
      ...(swapParams && { swapParams }),
    });
  }

  /**
   * Get automation wallet for a user
   *
   * Throws if wallet doesn't exist - wallet must be created during order registration in UI.
   * This is intentional: if wallet doesn't exist at execution time, it's an error condition.
   */
  async getWallet(userId: string): Promise<{ walletAddress: string }> {
    log.info({ userId, msg: 'Getting automation wallet' });

    const result = await this.request<{ wallet: { walletAddress: string } | null }>(
      'GET',
      `/api/wallets/automation?userId=${userId}`
    );

    if (!result.wallet) {
      throw new Error(`No automation wallet found for user ${userId}. Wallet must be created during order registration.`);
    }

    return { walletAddress: result.wallet.walletAddress };
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _signerClient: SignerClient | null = null;

export function getSignerClient(): SignerClient {
  if (!_signerClient) {
    _signerClient = new SignerClient();
  }
  return _signerClient;
}

export { SignerClient };
