/**
 * Signer Client
 *
 * HTTP client for communicating with the midcurve-signer service.
 * Handles signing of deployment and execution transactions.
 *
 * Note: registerClose and cancelClose are owner-only functions that users
 * sign with their own EOA wallet. Only executeClose (operator-only) needs
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
 * Swap parameters for executeClose with swap
 */
export interface SwapParamsInput {
  augustus: string;       // Augustus swapper address
  swapCalldata: string;   // Hex-encoded calldata
  deadline: number;       // Unix timestamp or 0 for no deadline
}

export interface ExecuteCloseParams {
  userId: string;
  chainId: number;
  contractAddress: string;
  closeId: number;
  feeRecipient: string;
  feeBps: number;
  // Operator address for gas estimation
  operatorAddress: string;
  // Optional explicit nonce for retry scenarios (caller fetches from chain)
  nonce?: number;
  // Optional swap params for post-close swap
  swapParams?: SwapParamsInput;
}

// =============================================================================
// Contract ABI (minimal for gas estimation)
// =============================================================================

const POSITION_CLOSER_ABI = [
  {
    type: 'function',
    name: 'executeClose',
    inputs: [
      { name: 'closeId', type: 'uint256' },
      { name: 'feeRecipient', type: 'address' },
      { name: 'feeBps', type: 'uint16' },
      {
        name: 'swapParams',
        type: 'tuple',
        components: [
          { name: 'augustus', type: 'address' },
          { name: 'swapCalldata', type: 'bytes' },
          { name: 'deadline', type: 'uint256' },
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
   * Sign an executeClose transaction
   *
   * Gas estimation is performed here before calling the signer.
   * This keeps the signer isolated from external RPC endpoints.
   *
   * For retry scenarios, pass an explicit nonce fetched from the chain.
   */
  async signExecuteClose(params: ExecuteCloseParams): Promise<SignedTransaction> {
    const { userId, chainId, contractAddress, closeId, feeRecipient, feeBps, operatorAddress, nonce, swapParams } =
      params;

    log.info({
      userId,
      chainId,
      contractAddress,
      closeId,
      explicitNonce: nonce,
      hasSwap: !!swapParams,
      msg: 'Estimating gas for close order execution',
    });

    // Estimate gas locally (automation service has RPC access)
    const publicClient = getPublicClient(chainId as SupportedChainId);

    // Build swap params tuple (use empty params if no swap)
    const swapParamsTuple = swapParams
      ? {
          augustus: swapParams.augustus as Address,
          swapCalldata: swapParams.swapCalldata as `0x${string}`,
          deadline: BigInt(swapParams.deadline),
        }
      : EMPTY_SWAP_PARAMS;

    const callData = encodeFunctionData({
      abi: POSITION_CLOSER_ABI,
      functionName: 'executeClose',
      args: [BigInt(closeId), feeRecipient as Address, feeBps, swapParamsTuple],
    });

    let gasLimit: bigint;
    let gasPrice: bigint;

    try {
      // Get current gas price and estimate gas
      [gasPrice, gasLimit] = await Promise.all([
        publicClient.getGasPrice(),
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
        closeId,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Gas estimation failed, using fallback values',
      });
      // Fallback values if estimation fails
      gasPrice = await publicClient.getGasPrice();
      gasLimit = 500_000n;
    }

    log.info({
      userId,
      chainId,
      contractAddress,
      closeId,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      msg: 'Signing close order execution',
    });

    // Call signer with gas params (and optional explicit nonce and swap params for retries)
    return this.request<SignedTransaction>('POST', '/api/sign/automation/execute-close', {
      userId,
      chainId,
      contractAddress,
      closeId,
      feeRecipient,
      feeBps,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      ...(nonce !== undefined && { nonce }),
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
