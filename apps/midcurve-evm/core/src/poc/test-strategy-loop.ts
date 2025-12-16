/**
 * Strategy Loop POC Test
 *
 * End-to-end test of the strategy loop with RabbitMQ integration:
 * 1. Deploy SimpleLoggingStrategy
 * 2. Setup RabbitMQ topology
 * 3. Start strategy loop
 * 4. Start simulated executor (consumes effects, publishes results)
 * 5. Publish test event
 * 6. Verify step commits successfully
 *
 * Usage:
 *   1. Start Geth + RabbitMQ: npm run up
 *   2. Build contracts: npm run build:contracts
 *   3. Run this test: npm run poc:strategy-loop
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  keccak256,
  toHex,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { SimpleLoggingStrategyAbi } from './abi.js';
import {
  decodeLogPayload,
  executeLogEffect,
  isLogEffect,
} from './effect-parser.js';

import {
  createDefaultMQClient,
  setupCoreTopology,
  setupStrategyTopology,
  teardownStrategyTopology,
  EXCHANGES,
  QUEUES,
  ROUTING_KEYS,
  type EffectRequestMessage,
  createEffectResult,
  createStepEvent,
  deserializeMessage,
  serializeMessage,
  isEffectRequestMessage,
} from '../mq/index.js';

import { StrategyLoop } from '../orchestrator/index.js';

// ============================================================
// Configuration
// ============================================================

// Foundry account #0 (pre-funded in genesis)
const OPERATOR_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const OPERATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

// Chain configuration
const CHAIN_ID = 31337;
const RPC_URL = 'http://localhost:8545';

// Event type for test
const PING_EVENT_TYPE = keccak256(toHex('PING'));

// ============================================================
// Setup
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const localChain = {
  id: CHAIN_ID,
  name: 'Midcurve Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
} as const;

const account = privateKeyToAccount(OPERATOR_PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: localChain,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: localChain,
  transport: http(RPC_URL),
});

// ============================================================
// Contract Deployment
// ============================================================

function loadBytecode(): Hex {
  const artifactPath = join(
    __dirname,
    '../../../contracts/out/SimpleLoggingStrategy.sol/SimpleLoggingStrategy.json'
  );

  try {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    return artifact.bytecode.object as Hex;
  } catch (error) {
    console.error('Failed to load contract bytecode.');
    console.error('Make sure you have built contracts: npm run build:contracts');
    throw error;
  }
}

async function deployStrategy(): Promise<Address> {
  console.log('Deploying SimpleLoggingStrategy...');

  const bytecode = loadBytecode();

  const encodedArgs = encodeAbiParameters(
    [
      { type: 'address', name: 'operator_' },
      { type: 'address', name: 'core_' },
    ],
    [OPERATOR_ADDRESS, OPERATOR_ADDRESS]
  );

  const deployData = (bytecode + encodedArgs.slice(2)) as Hex;

  const hash = await walletClient.deployContract({
    abi: SimpleLoggingStrategyAbi,
    bytecode: deployData,
    args: [],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error('Contract deployment failed');
  }

  console.log(`Strategy deployed at: ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

// ============================================================
// Simulated Executor
// ============================================================

/**
 * Simulated executor that consumes effect requests and publishes results.
 * In production, this would be a separate process/service.
 */
class SimulatedExecutor {
  private consumerTag: string | null = null;
  private effectsHandled = 0;

  constructor(
    private channel: Awaited<ReturnType<typeof createDefaultMQClient>>['getChannel'] extends () => infer R ? R : never,
    private executorId: string = 'test-executor-1'
  ) {}

  async start(): Promise<void> {
    console.log(`[Executor] Starting ${this.executorId}...`);

    // Set prefetch to process one effect at a time
    await this.channel.prefetch(1);

    const response = await this.channel.consume(
      QUEUES.EFFECTS_PENDING,
      async (msg) => {
        if (!msg) return;

        try {
          const request = deserializeMessage<EffectRequestMessage>(msg.content);

          if (!isEffectRequestMessage(request)) {
            console.error('[Executor] Invalid message format');
            this.channel.nack(msg, false, false); // Discard
            return;
          }

          await this.handleEffect(request);
          this.channel.ack(msg);
        } catch (error) {
          console.error('[Executor] Failed to handle effect:', error);
          this.channel.nack(msg, false, true); // Requeue
        }
      },
      { noAck: false }
    );

    this.consumerTag = response.consumerTag;
    console.log(`[Executor] Consuming from ${QUEUES.EFFECTS_PENDING}`);
  }

  async stop(): Promise<void> {
    if (this.consumerTag) {
      await this.channel.cancel(this.consumerTag);
      this.consumerTag = null;
    }
    console.log(`[Executor] Stopped. Effects handled: ${this.effectsHandled}`);
  }

  getEffectsHandled(): number {
    return this.effectsHandled;
  }

  private async handleEffect(request: EffectRequestMessage): Promise<void> {
    console.log(
      `[Executor] Handling effect: ` +
        `type=${request.effectType.slice(0, 10)}... ` +
        `key=${request.idempotencyKey.slice(0, 10)}...`
    );

    let resultData: Hex = '0x';

    // Execute the effect based on type
    if (isLogEffect(request.effectType as Hex)) {
      // LOG effect - decode and print
      const logPayload = decodeLogPayload(request.payload as Hex);
      executeLogEffect(logPayload);
      resultData = '0x';
    } else {
      console.log(`[Executor] Unknown effect type, returning empty result`);
    }

    // Create and publish result
    const result = createEffectResult(request, true, resultData, this.executorId);

    const published = this.channel.publish(
      EXCHANGES.RESULTS,
      request.strategyAddress.toLowerCase(),
      serializeMessage(result),
      {
        persistent: true,
        contentType: 'application/json',
        correlationId: request.correlationId,
      }
    );

    if (!published) {
      throw new Error('Failed to publish result');
    }

    this.effectsHandled++;
    console.log(`[Executor] Result published for ${request.correlationId}`);
  }
}

// ============================================================
// Main Test
// ============================================================

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Strategy Loop POC Test');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check Geth connection
  try {
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`Connected to Geth node. Block number: ${blockNumber}`);
  } catch {
    console.error('Failed to connect to Geth node.');
    console.error('Make sure the node is running: npm run up');
    process.exit(1);
  }

  // Connect to RabbitMQ
  const mqClient = createDefaultMQClient();
  try {
    await mqClient.connect();
    console.log('Connected to RabbitMQ.\n');
  } catch {
    console.error('Failed to connect to RabbitMQ.');
    console.error('Make sure RabbitMQ is running: npm run up');
    process.exit(1);
  }

  const channel = mqClient.getChannel();
  let strategyAddress: Address | null = null;
  let executor: SimulatedExecutor | null = null;
  let strategyLoop: StrategyLoop | null = null;

  try {
    // Step 1: Setup topology
    console.log('Step 1: Setting up RabbitMQ topology...');
    await setupCoreTopology(channel);
    console.log('✓ Core topology ready\n');

    // Step 2: Deploy strategy
    console.log('Step 2: Deploying strategy...');
    strategyAddress = await deployStrategy();
    console.log('');

    // Step 3: Setup strategy topology
    console.log('Step 3: Setting up strategy topology...');
    await setupStrategyTopology(channel, strategyAddress);
    console.log('✓ Strategy topology ready\n');

    // Step 4: Start executor
    console.log('Step 4: Starting simulated executor...');
    executor = new SimulatedExecutor(channel);
    await executor.start();
    console.log('✓ Executor ready\n');

    // Step 5: Create strategy loop (but don't start yet)
    console.log('Step 5: Creating strategy loop...');
    strategyLoop = new StrategyLoop({
      strategyAddress,
      channel,
      operatorPrivateKey: OPERATOR_PRIVATE_KEY,
      rpcUrl: RPC_URL,
      chainId: CHAIN_ID,
      abi: SimpleLoggingStrategyAbi,
      maxIterations: 20,
      resultPollIntervalMs: 50,
    });
    console.log('✓ Strategy loop created\n');

    // Step 6: Publish test event
    console.log('Step 6: Publishing PING event...');
    const pingEvent = createStepEvent(PING_EVENT_TYPE, 1, '0x', 'test');

    const routingKey = ROUTING_KEYS.action(strategyAddress);
    channel.publish(
      EXCHANGES.EVENTS,
      routingKey,
      serializeMessage(pingEvent),
      { persistent: true }
    );
    console.log(`✓ Event published to ${routingKey}\n`);

    // Step 7: Start strategy loop and wait for completion
    console.log('Step 7: Starting strategy loop (processing 1 event)...');
    console.log('───────────────────────────────────────────────────────────');

    // Run the loop in background with timeout
    const loopPromise = strategyLoop.start();

    // Wait for event to be processed (with timeout)
    const timeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const state = strategyLoop.getState();
      if (state.eventsProcessed >= 1) {
        break;
      }
      await sleep(100);
    }

    // Stop the loop
    await strategyLoop.stop();

    // Wait for loop to fully stop
    try {
      await Promise.race([
        loopPromise,
        sleep(5000).then(() => {
          throw new Error('Loop stop timeout');
        }),
      ]);
    } catch {
      // Expected - loop throws when aborted
    }

    console.log('───────────────────────────────────────────────────────────\n');

    // Step 8: Verify results
    console.log('Step 8: Verifying results...');

    const finalState = strategyLoop.getState();
    const effectsHandled = executor.getEffectsHandled();

    const finalEpoch = await publicClient.readContract({
      address: strategyAddress,
      abi: SimpleLoggingStrategyAbi,
      functionName: 'epoch',
    });

    const finalEventsProcessed = await publicClient.readContract({
      address: strategyAddress,
      abi: SimpleLoggingStrategyAbi,
      functionName: 'eventsProcessed',
    });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Results');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Events processed (loop): ${finalState.eventsProcessed}`);
    console.log(`  Effects processed (loop): ${finalState.effectsProcessed}`);
    console.log(`  Effects handled (executor): ${effectsHandled}`);
    console.log(`  Contract epoch: ${finalEpoch}`);
    console.log(`  Contract eventsProcessed: ${finalEventsProcessed}`);
    console.log('═══════════════════════════════════════════════════════════');

    // Validate
    const success =
      finalState.eventsProcessed === 1 &&
      finalState.effectsProcessed === 4 && // 4 LOG effects
      effectsHandled === 4 &&
      finalEpoch === 1n &&
      finalEventsProcessed === 1n;

    if (success) {
      console.log('\n✓ POC successful!');
      console.log('  - Strategy loop consumed event from RabbitMQ');
      console.log('  - 4 effect requests published to effects.pending');
      console.log('  - Executor consumed and fulfilled all effects');
      console.log('  - Results routed back via strategy.{addr}.results');
      console.log('  - Transaction committed, epoch incremented');
    } else {
      console.log('\n✗ POC failed!');
      process.exit(1);
    }
  } finally {
    // Cleanup
    console.log('\nCleaning up...');

    if (executor) {
      await executor.stop();
    }

    if (strategyAddress) {
      await teardownStrategyTopology(channel, strategyAddress);
    }

    // Purge effects.pending queue
    try {
      await channel.purgeQueue(QUEUES.EFFECTS_PENDING);
    } catch {
      // Queue might not exist
    }

    await mqClient.disconnect();
    console.log('Cleanup complete.');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
