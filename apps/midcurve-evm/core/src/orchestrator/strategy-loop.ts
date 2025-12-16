/**
 * Strategy Event Loop
 *
 * Per-strategy event loop that integrates the durable await pattern with RabbitMQ.
 *
 * Flow:
 * 1. Priority check: drain results queue (non-blocking)
 * 2. If no pending effects: consume from events queue (blocking)
 * 3. Process event via simulation-replay loop
 * 4. Publish effect requests, consume results, commit transaction
 *
 * Transaction Signing:
 * - Uses signer API for production (KMS-backed signing)
 * - Falls back to local private key for development/testing
 */

import type { Channel } from 'amqplib';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  type Hex,
  type Address,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  type EffectRequestMessage,
  type EffectResultMessage,
  type StepEventMessage,
  createEffectRequest,
  stringToBigint,
  tryConsumeResult,
  tryConsumeEvent,
  consumeEvent,
  ackResult,
  ackEvent,
  nackEvent,
  publishEffectRequest,
} from '../mq/index';

import {
  parseEffectNeededFromError,
  type EffectRequest,
} from '../poc/effect-parser';

import {
  type SignerClient,
} from '../clients/signer-client';

// ============================================================
// Types
// ============================================================

/**
 * Base configuration for StrategyLoop
 */
interface StrategyLoopConfigBase {
  /** Strategy contract address */
  strategyAddress: Address;
  /** RabbitMQ channel */
  channel: Channel;
  /** RPC URL for the Geth node */
  rpcUrl: string;
  /** Chain ID */
  chainId: number;
  /** Contract ABI */
  abi: readonly unknown[];
  /** Maximum iterations per event (safety limit) */
  maxIterations?: number;
  /** Polling interval when waiting for results (ms) */
  resultPollIntervalMs?: number;
}

/**
 * Configuration using signer API (production mode)
 */
interface StrategyLoopConfigWithSigner extends StrategyLoopConfigBase {
  /** Strategy ID for signer API calls */
  strategyId: string;
  /** Signer client for signing transactions */
  signerClient: SignerClient;
  operatorPrivateKey?: never;
}

/**
 * Configuration using local private key (development mode)
 */
interface StrategyLoopConfigWithPrivateKey extends StrategyLoopConfigBase {
  /** Operator private key for signing transactions (dev only) */
  operatorPrivateKey: Hex;
  strategyId?: never;
  signerClient?: never;
}

export type StrategyLoopConfig = StrategyLoopConfigWithSigner | StrategyLoopConfigWithPrivateKey;

export interface StrategyLoopState {
  /** Number of pending effects waiting for results */
  pendingEffects: number;
  /** Current event being processed */
  currentEvent: StepEventMessage | null;
  /** Current event's RabbitMQ delivery tag */
  currentDeliveryTag: number | null;
  /** Whether the loop is running */
  running: boolean;
  /** Current epoch (from contract) */
  epoch: bigint;
  /** Total events processed */
  eventsProcessed: number;
  /** Total effects processed */
  effectsProcessed: number;
}

// ============================================================
// Strategy Loop Class
// ============================================================

export class StrategyLoop {
  private config: StrategyLoopConfigBase & {
    maxIterations: number;
    resultPollIntervalMs: number;
    strategyId?: string;
    signerClient?: SignerClient;
    operatorPrivateKey?: Hex;
  };
  private state: StrategyLoopState;
  private chain: Chain;
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private account: Account | null = null;
  private abortController: AbortController | null = null;

  /** True if using signer API, false if using local private key */
  private readonly useSignerApi: boolean;

  constructor(config: StrategyLoopConfig) {
    this.config = {
      ...config,
      maxIterations: config.maxIterations ?? 50,
      resultPollIntervalMs: config.resultPollIntervalMs ?? 100,
    };

    this.state = {
      pendingEffects: 0,
      currentEvent: null,
      currentDeliveryTag: null,
      running: false,
      epoch: 0n,
      eventsProcessed: 0,
      effectsProcessed: 0,
    };

    // Determine signing mode
    this.useSignerApi = 'signerClient' in config && !!config.signerClient;

    this.chain = {
      id: this.config.chainId,
      name: 'Midcurve EVM',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [this.config.rpcUrl] },
      },
    } as Chain;

    // Setup public client (always needed for reads and tx receipts)
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(this.config.rpcUrl),
    });

    // Setup wallet client only if using local private key
    if (!this.useSignerApi && this.config.operatorPrivateKey) {
      this.account = privateKeyToAccount(this.config.operatorPrivateKey);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: this.chain,
        transport: http(this.config.rpcUrl),
      });
    }
  }

  /**
   * Get current loop state.
   */
  getState(): Readonly<StrategyLoopState> {
    return { ...this.state };
  }

  /**
   * Start the strategy loop.
   */
  async start(): Promise<void> {
    if (this.state.running) {
      throw new Error('Strategy loop already running');
    }

    this.state.running = true;
    this.abortController = new AbortController();

    console.log(
      `[StrategyLoop] Starting loop for ${this.config.strategyAddress.slice(0, 10)}...`
    );

    // Fetch initial epoch from contract
    await this.refreshEpoch();
    console.log(`[StrategyLoop] Initial epoch: ${this.state.epoch}`);

    // Main loop
    try {
      await this.consumeLoop();
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        console.log('[StrategyLoop] Loop stopped gracefully');
      } else {
        console.error('[StrategyLoop] Loop failed:', error);
        throw error;
      }
    } finally {
      this.state.running = false;
      this.abortController = null;
    }
  }

  /**
   * Stop the strategy loop gracefully.
   */
  async stop(): Promise<void> {
    if (!this.state.running) {
      return;
    }

    console.log('[StrategyLoop] Stopping loop...');
    this.abortController?.abort();
  }

  // ============================================================
  // Main Loop
  // ============================================================

  /**
   * Main consumer loop with priority handling.
   */
  private async consumeLoop(): Promise<void> {
    while (this.state.running && !this.abortController?.signal.aborted) {
      // Priority 1: Drain results queue
      const resultHandled = await this.checkAndHandleResults();
      if (resultHandled) {
        // Result was handled, continue to check for more
        continue;
      }

      // Priority 2: Only process new events if no pending effects
      if (this.state.pendingEffects === 0) {
        await this.consumeAndProcessEvent();
      } else {
        // Have pending effects but no results yet - poll with delay
        await this.sleep(this.config.resultPollIntervalMs);
      }
    }
  }

  /**
   * Check for and handle a result from the results queue.
   * @returns true if a result was handled
   */
  private async checkAndHandleResults(): Promise<boolean> {
    const consumed = await tryConsumeResult(
      this.config.channel,
      this.config.strategyAddress
    );

    if (!consumed) {
      return false;
    }

    try {
      await this.handleEffectResult(consumed.message);
      ackResult(this.config.channel, consumed.deliveryTag);
      return true;
    } catch (error) {
      console.error('[StrategyLoop] Failed to handle result:', error);
      // Don't NACK - result will be retried when executor republishes
      // ACK to prevent infinite retry of bad messages
      ackResult(this.config.channel, consumed.deliveryTag);
      return true;
    }
  }

  /**
   * Consume and process a new event from the events queue.
   */
  private async consumeAndProcessEvent(): Promise<void> {
    // Try non-blocking first
    let consumed = await tryConsumeEvent(
      this.config.channel,
      this.config.strategyAddress
    );

    if (!consumed) {
      // Block waiting for an event (with timeout for abort checking)
      try {
        consumed = await consumeEvent(
          this.config.channel,
          this.config.strategyAddress,
          5000 // 5 second timeout to check abort signal
        );
      } catch {
        // Timeout or cancelled - check abort signal and continue
        return;
      }
    }

    // Store current event context
    this.state.currentEvent = consumed.message;
    this.state.currentDeliveryTag = consumed.deliveryTag;

    try {
      await this.processEvent(consumed.message);
      ackEvent(this.config.channel, consumed.deliveryTag);
      this.state.eventsProcessed++;
      console.log(
        `[StrategyLoop] Event completed. Total events: ${this.state.eventsProcessed}`
      );
    } catch (error) {
      console.error('[StrategyLoop] Failed to process event:', error);
      // NACK to requeue for retry
      nackEvent(this.config.channel, consumed.deliveryTag, true);
    } finally {
      this.state.currentEvent = null;
      this.state.currentDeliveryTag = null;
    }
  }

  // ============================================================
  // Event Processing (Durable Await Loop)
  // ============================================================

  /**
   * Process an event using the durable await simulation-replay pattern.
   */
  private async processEvent(event: StepEventMessage): Promise<void> {
    console.log(
      `[StrategyLoop] Processing event: type=${event.eventType.slice(0, 10)}... source=${event.source}`
    );

    // Encode step input from event
    const stepInput = this.encodeStepInput(event);
    let iteration = 0;

    while (iteration < this.config.maxIterations) {
      iteration++;

      // Check abort signal
      if (this.abortController?.signal.aborted) {
        throw new Error('Loop aborted');
      }

      console.log(`[StrategyLoop] Simulation ${iteration}`);

      try {
        // Simulate step()
        await this.simulateStep(stepInput);

        // Simulation succeeded - commit transaction
        console.log('[StrategyLoop] Simulation succeeded, committing...');
        await this.commitStep(stepInput);

        // Refresh epoch after commit
        await this.refreshEpoch();
        console.log(`[StrategyLoop] Committed. New epoch: ${this.state.epoch}`);
        return;
      } catch (error) {
        // Check if EffectNeeded
        const effect = parseEffectNeededFromError(error);

        if (!effect) {
          // Not an EffectNeeded error - something else failed
          throw error;
        }

        // Publish effect request
        await this.handleEffectNeeded(effect);

        // Wait for result before re-simulating
        await this.waitForEffectResult();
      }
    }

    throw new Error(`Exceeded maximum iterations (${this.config.maxIterations})`);
  }

  /**
   * Handle an EffectNeeded error by publishing the request.
   */
  private async handleEffectNeeded(effect: EffectRequest): Promise<void> {
    this.state.effectsProcessed++;
    console.log(
      `[StrategyLoop] Effect #${this.state.effectsProcessed} needed: ` +
        `type=${effect.effectType.slice(0, 10)}... key=${effect.idempotencyKey.slice(0, 10)}...`
    );

    // Create and publish effect request message
    const request = createEffectRequest(
      this.config.strategyAddress,
      effect.epoch,
      effect.idempotencyKey,
      effect.effectType,
      effect.payload
    );

    const published = publishEffectRequest(this.config.channel, request);
    if (!published) {
      throw new Error('Failed to publish effect request - channel buffer full');
    }

    this.state.pendingEffects++;
  }

  /**
   * Wait for an effect result to arrive.
   */
  private async waitForEffectResult(): Promise<void> {
    console.log('[StrategyLoop] Waiting for effect result...');

    while (this.state.pendingEffects > 0) {
      // Check abort signal
      if (this.abortController?.signal.aborted) {
        throw new Error('Loop aborted while waiting for result');
      }

      const consumed = await tryConsumeResult(
        this.config.channel,
        this.config.strategyAddress
      );

      if (consumed) {
        await this.handleEffectResult(consumed.message);
        ackResult(this.config.channel, consumed.deliveryTag);
        return;
      }

      // Poll with delay
      await this.sleep(this.config.resultPollIntervalMs);
    }
  }

  /**
   * Handle an effect result by submitting it on-chain.
   */
  private async handleEffectResult(result: EffectResultMessage): Promise<void> {
    const elapsedMs = result.completedAt - result.requestedAt;
    console.log(
      `[StrategyLoop] Handling result: ` +
        `key=${result.idempotencyKey.slice(0, 10)}... ` +
        `ok=${result.ok} elapsed=${elapsedMs}ms`
    );

    // Submit result to contract
    await this.submitEffectResult(
      stringToBigint(result.epoch),
      result.idempotencyKey as Hex,
      result.ok,
      result.data as Hex
    );

    this.state.pendingEffects--;
    console.log(
      `[StrategyLoop] Result submitted. Pending effects: ${this.state.pendingEffects}`
    );
  }

  // ============================================================
  // Contract Interactions
  // ============================================================

  /**
   * Encode step event as contract input.
   */
  private encodeStepInput(event: StepEventMessage): Hex {
    return encodeAbiParameters(
      [
        { type: 'bytes32', name: 'eventType' },
        { type: 'uint32', name: 'eventVersion' },
        { type: 'bytes', name: 'payload' },
      ],
      [event.eventType as Hex, event.eventVersion, event.payload as Hex]
    );
  }

  /**
   * Simulate step() via eth_call.
   * Uses an arbitrary account for simulation (doesn't need signing).
   */
  private async simulateStep(input: Hex): Promise<void> {
    // For simulation, we can use any account address
    // The actual signing happens in commitStep
    const simulationAccount = this.walletClient?.account?.address
      ?? '0x0000000000000000000000000000000000000001' as Address;

    await this.publicClient.simulateContract({
      address: this.config.strategyAddress,
      abi: this.config.abi,
      functionName: 'step',
      args: [input],
      account: simulationAccount,
    });
  }

  /**
   * Commit step() as a real transaction.
   * Uses signer API in production, local wallet in development.
   */
  private async commitStep(input: Hex): Promise<void> {
    if (this.useSignerApi) {
      await this.commitStepViaSigner(input);
    } else {
      await this.commitStepViaWallet(input);
    }
  }

  /**
   * Commit step() via signer API (production mode).
   */
  private async commitStepViaSigner(input: Hex): Promise<void> {
    if (!this.config.signerClient || !this.config.strategyId) {
      throw new Error('Signer client not configured');
    }

    // Sign the transaction via signer API
    const signResult = await this.config.signerClient.signStep({
      strategyId: this.config.strategyId,
      stepInput: input,
    });

    // Broadcast the signed transaction
    const txHash = await this.publicClient.sendRawTransaction({
      serializedTransaction: signResult.signedTransaction,
    });

    // Wait for confirmation
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  /**
   * Commit step() via local wallet (development mode).
   */
  private async commitStepViaWallet(input: Hex): Promise<void> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet client not configured');
    }

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: this.config.strategyAddress,
      abi: this.config.abi,
      functionName: 'step',
      args: [input],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
  }

  /**
   * Submit effect result to contract.
   * Uses signer API in production, local wallet in development.
   */
  private async submitEffectResult(
    epoch: bigint,
    idempotencyKey: Hex,
    ok: boolean,
    data: Hex
  ): Promise<void> {
    if (this.useSignerApi) {
      await this.submitEffectResultViaSigner(epoch, idempotencyKey, ok, data);
    } else {
      await this.submitEffectResultViaWallet(epoch, idempotencyKey, ok, data);
    }
  }

  /**
   * Submit effect result via signer API (production mode).
   */
  private async submitEffectResultViaSigner(
    epoch: bigint,
    idempotencyKey: Hex,
    ok: boolean,
    data: Hex
  ): Promise<void> {
    if (!this.config.signerClient || !this.config.strategyId) {
      throw new Error('Signer client not configured');
    }

    // Sign the transaction via signer API
    const signResult = await this.config.signerClient.signSubmitEffectResult({
      strategyId: this.config.strategyId,
      epoch: epoch.toString(),
      idempotencyKey,
      ok,
      data,
    });

    // Broadcast the signed transaction
    const txHash = await this.publicClient.sendRawTransaction({
      serializedTransaction: signResult.signedTransaction,
    });

    // Wait for confirmation
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  /**
   * Submit effect result via local wallet (development mode).
   */
  private async submitEffectResultViaWallet(
    epoch: bigint,
    idempotencyKey: Hex,
    ok: boolean,
    data: Hex
  ): Promise<void> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet client not configured');
    }

    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: this.config.strategyAddress,
      abi: this.config.abi,
      functionName: 'submitEffectResult',
      args: [epoch, idempotencyKey, ok, data],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
  }

  /**
   * Refresh epoch from contract.
   */
  private async refreshEpoch(): Promise<void> {
    const epoch = await this.publicClient.readContract({
      address: this.config.strategyAddress,
      abi: this.config.abi,
      functionName: 'epoch',
    });
    this.state.epoch = epoch as bigint;
  }

  // ============================================================
  // Utilities
  // ============================================================

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
