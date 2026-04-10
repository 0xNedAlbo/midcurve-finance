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
 * A single hop in the swap route through MidcurveSwapRouter
 */
export interface HopInput {
  venueId: string;      // bytes32 hex (e.g. keccak256("UniswapV3"))
  tokenIn: string;      // Token in address
  tokenOut: string;     // Token out address
  venueData: string;    // Hex-encoded venue-specific data (e.g. abi.encode(uint24 fee))
}

/**
 * WithdrawParams for executeOrder (off-chain computed withdrawal mins)
 */
export interface WithdrawParamsInput {
  amount0Min: string;   // Minimum token0 from decreaseLiquidity
  amount1Min: string;   // Minimum token1 from decreaseLiquidity
}

/**
 * SwapParams for executeOrder with two-phase swap via MidcurveSwapRouter
 */
export interface SwapParamsInput {
  guaranteedAmountIn: string;  // Guaranteed amount routed through Paraswap
  minAmountOut: string;        // Minimum output from Paraswap route
  deadline: number;            // Unix timestamp or 0 for no deadline
  hops: HopInput[];            // Paraswap route hops
}

/**
 * FeeParams for executeOrder
 */
export interface FeeParamsInput {
  feeRecipient: string;
  feeBps: number;
}

export interface ExecuteOrderParams {
  userId: string;
  chainId: number;
  contractAddress: string;
  nftId: bigint;
  triggerMode: number; // 0=LOWER, 1=UPPER
  // Operator address for gas estimation
  operatorAddress: string;
  // Nonce for transaction (caller fetches from chain)
  nonce: number;
  // New structured params
  withdrawParams: WithdrawParamsInput;
  swapParams: SwapParamsInput;
  feeParams: FeeParamsInput;
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
      {
        name: 'withdrawParams',
        type: 'tuple',
        components: [
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
        ],
      },
      {
        name: 'swapParams',
        type: 'tuple',
        components: [
          { name: 'guaranteedAmountIn', type: 'uint256' },
          { name: 'minAmountOut', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          {
            name: 'hops',
            type: 'tuple[]',
            components: [
              { name: 'venueId', type: 'bytes32' },
              { name: 'tokenIn', type: 'address' },
              { name: 'tokenOut', type: 'address' },
              { name: 'venueData', type: 'bytes' },
            ],
          },
        ],
      },
      {
        name: 'feeParams',
        type: 'tuple',
        components: [
          { name: 'feeRecipient', type: 'address' },
          { name: 'feeBps', type: 'uint16' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// =============================================================================
// Client
// =============================================================================

class SignerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private cachedOperatorAddress: string | null = null;

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
   * Sign a generic contract transaction with pre-encoded calldata.
   *
   * Gas estimation is performed here (automation has RPC access).
   * The signer is isolated from external RPC endpoints.
   *
   * Each execution module (NFT, vault) encodes its own calldata using
   * its contract ABI and specifies the signer endpoint to call.
   */
  async signTransaction(params: {
    userId: string;
    chainId: number;
    contractAddress: string;
    operatorAddress: string;
    nonce: number;
    callData: `0x${string}`;
    signerEndpoint: string;
    /** Extra fields forwarded to the signer (e.g. nftId, triggerMode for logging) */
    signerPayload: Record<string, unknown>;
  }): Promise<SignedTransaction> {
    const { userId, chainId, contractAddress, operatorAddress, nonce, callData, signerEndpoint, signerPayload } = params;

    log.info({
      userId,
      chainId,
      contractAddress,
      operatorAddress,
      explicitNonce: nonce,
      signerEndpoint,
      msg: 'Estimating gas for transaction signing',
    });

    const publicClient = getPublicClient(chainId as SupportedChainId);

    let gasLimit: bigint;
    let gasPrice: bigint;

    try {
      [gasPrice, gasLimit] = await Promise.all([
        publicClient.getGasPrice().then((price) => (price * 120n) / 100n),
        publicClient.estimateGas({
          account: operatorAddress as Address,
          to: contractAddress as Address,
          data: callData,
        }).then((estimate) => (estimate * 120n) / 100n),
      ]);
    } catch (error) {
      log.warn({
        userId,
        chainId,
        contractAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'Gas estimation failed, using fallback values',
      });
      gasPrice = await publicClient.getGasPrice().then((price) => (price * 120n) / 100n);
      gasLimit = 500_000n;
    }

    log.info({
      userId,
      chainId,
      contractAddress,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      msg: 'Signing transaction',
    });

    return this.request<SignedTransaction>('POST', signerEndpoint, {
      userId,
      chainId,
      contractAddress,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      nonce,
      ...signerPayload,
    });
  }

  /**
   * Sign an NFT executeOrder transaction (legacy convenience wrapper).
   *
   * @deprecated Use signTransaction with pre-encoded calldata instead.
   */
  async signExecuteOrder(params: ExecuteOrderParams): Promise<SignedTransaction> {
    const { userId, chainId, contractAddress, nftId, triggerMode, operatorAddress, nonce, withdrawParams, swapParams, feeParams } =
      params;

    const withdrawParamsTuple = {
      amount0Min: BigInt(withdrawParams.amount0Min),
      amount1Min: BigInt(withdrawParams.amount1Min),
    };

    const swapParamsTuple = {
      guaranteedAmountIn: BigInt(swapParams.guaranteedAmountIn),
      minAmountOut: BigInt(swapParams.minAmountOut),
      deadline: BigInt(swapParams.deadline),
      hops: swapParams.hops.map((hop) => ({
        venueId: hop.venueId as `0x${string}`,
        tokenIn: hop.tokenIn as Address,
        tokenOut: hop.tokenOut as Address,
        venueData: hop.venueData as `0x${string}`,
      })),
    };

    const feeParamsTuple = {
      feeRecipient: feeParams.feeRecipient as Address,
      feeBps: feeParams.feeBps,
    };

    const callData = encodeFunctionData({
      abi: POSITION_CLOSER_ABI,
      functionName: 'executeOrder',
      args: [nftId, triggerMode, withdrawParamsTuple, swapParamsTuple, feeParamsTuple],
    });

    return this.signTransaction({
      userId,
      chainId,
      contractAddress,
      operatorAddress,
      nonce,
      callData,
      signerEndpoint: '/api/sign/automation/uniswapv3/position-closer/execute-order',
      signerPayload: {
        nftId: nftId.toString(),
        triggerMode,
        withdrawParams,
        swapParams,
        feeParams,
      },
    });
  }

  /**
   * Create the operator wallet (or return existing).
   * Called on automation startup to ensure the key exists.
   * Also serves as a signer health check.
   *
   * Retries with linear backoff because services start concurrently —
   * the signer may not be ready when automation starts.
   */
  async createOperatorWallet(): Promise<string> {
    log.info({ msg: 'Ensuring operator wallet exists via signer service' });

    const MAX_RETRIES = 10;
    const RETRY_DELAY_MS = 3000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.request<{ address: string }>(
          'POST',
          '/api/operator/wallet'
        );

        this.cachedOperatorAddress = result.address;
        log.info({ operatorAddress: result.address, msg: 'Operator wallet ready' });
        return result.address;
      } catch (error) {
        if (attempt === MAX_RETRIES) throw error;

        const delayMs = attempt * RETRY_DELAY_MS;
        log.warn({
          attempt,
          maxRetries: MAX_RETRIES,
          nextRetryMs: delayMs,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Signer not ready, retrying...',
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error('Unreachable');
  }

  /**
   * Get the operator address for gas estimation.
   * Returns cached value if available (address never changes).
   */
  async getOperatorAddress(): Promise<string> {
    if (this.cachedOperatorAddress) {
      return this.cachedOperatorAddress;
    }

    const result = await this.request<{ address: string }>(
      'GET',
      '/api/operator/address'
    );

    this.cachedOperatorAddress = result.address;
    return result.address;
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
