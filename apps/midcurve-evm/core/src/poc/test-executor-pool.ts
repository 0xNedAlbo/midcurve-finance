/**
 * Executor Pool POC Test
 *
 * End-to-end test of the executor pool with multiple executors:
 * 1. Deploy SimpleLoggingStrategy
 * 2. Setup RabbitMQ topology
 * 3. Start executor pool (3 instances)
 * 4. Start strategy loop
 * 5. Publish multiple PING events
 * 6. Verify all effects processed by pool
 * 7. Verify load distributed across executors
 * 8. Cleanup
 *
 * Usage:
 *   1. Start Geth + RabbitMQ: npm run up
 *   2. Build contracts: npm run build:contracts
 *   3. Run this test: npm run poc:executor-pool
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
  createDefaultMQClient,
  setupCoreTopology,
  setupStrategyTopology,
  teardownStrategyTopology,
  QUEUES,
  ROUTING_KEYS,
  EXCHANGES,
  createStepEvent,
  serializeMessage,
} from '../mq/index.js';

import { StrategyLoop } from '../orchestrator/index.js';
import { ExecutorPool } from '../executor/index.js';

// ============================================================
// Configuration
// ============================================================

// Foundry account #0 (pre-funded in genesis)
const OPERATOR_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const OPERATOR_ADDRESS =
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

// Chain configuration
const CHAIN_ID = 31337;
const RPC_URL = 'http://localhost:8555';

// Event type for test
const PING_EVENT_TYPE = keccak256(toHex('PING'));

// Test configuration
const NUM_EVENTS = 3; // Number of PING events to send
const POOL_SIZE = 3; // Number of executors in the pool

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
// Main Test
// ============================================================

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Executor Pool POC Test');
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
  let executorPool: ExecutorPool | null = null;
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

    // Step 4: Start executor pool
    console.log(`Step 4: Starting executor pool (${POOL_SIZE} instances)...`);
    executorPool = new ExecutorPool({
      channel,
      poolSize: POOL_SIZE,
      executorIdPrefix: 'test-executor',
    });
    await executorPool.start();
    console.log('✓ Executor pool ready\n');

    // Step 5: Create strategy loop
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

    // Step 6: Publish multiple test events
    console.log(`Step 6: Publishing ${NUM_EVENTS} PING events...`);
    const routingKey = ROUTING_KEYS.action(strategyAddress);

    for (let i = 0; i < NUM_EVENTS; i++) {
      const pingEvent = createStepEvent(PING_EVENT_TYPE, 1, '0x', 'test');
      channel.publish(
        EXCHANGES.EVENTS,
        routingKey,
        serializeMessage(pingEvent),
        { persistent: true }
      );
      console.log(`  Published event ${i + 1}/${NUM_EVENTS}`);
    }
    console.log(`✓ All ${NUM_EVENTS} events published\n`);

    // Step 7: Start strategy loop and process events
    console.log(`Step 7: Processing ${NUM_EVENTS} events...`);
    console.log('───────────────────────────────────────────────────────────');

    // Run the loop in background
    const loopPromise = strategyLoop.start();

    // Wait for all events to be processed (with timeout)
    const timeout = 60000; // 60 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const state = strategyLoop.getState();
      if (state.eventsProcessed >= NUM_EVENTS) {
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
    const poolStats = executorPool.getStats();

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
    console.log(`  Effects processed (pool): ${poolStats.totalProcessed}`);
    console.log(`  Effects failed (pool): ${poolStats.totalFailed}`);
    console.log(`  Contract epoch: ${finalEpoch}`);
    console.log(`  Contract eventsProcessed: ${finalEventsProcessed}`);
    console.log('───────────────────────────────────────────────────────────');
    console.log('  Per-Executor Statistics:');
    for (const { id, stats } of poolStats.executors) {
      console.log(`    ${id}: processed=${stats.processed}, failed=${stats.failed}`);
    }
    console.log('═══════════════════════════════════════════════════════════');

    // Validate
    const expectedEffects = NUM_EVENTS * 4; // 4 LOG effects per event
    const success =
      finalState.eventsProcessed === NUM_EVENTS &&
      finalState.effectsProcessed === expectedEffects &&
      poolStats.totalProcessed === expectedEffects &&
      poolStats.totalFailed === 0 &&
      finalEpoch === BigInt(NUM_EVENTS) &&
      finalEventsProcessed === BigInt(NUM_EVENTS);

    // Check load distribution (at least 2 executors should have processed something)
    const activeExecutors = poolStats.executors.filter(
      ({ stats }) => stats.processed > 0
    ).length;
    const goodDistribution = activeExecutors >= Math.min(2, POOL_SIZE);

    if (success && goodDistribution) {
      console.log('\n✓ POC successful!');
      console.log(`  - ${NUM_EVENTS} events processed by strategy loop`);
      console.log(`  - ${expectedEffects} effect requests processed by executor pool`);
      console.log(`  - Load distributed across ${activeExecutors}/${POOL_SIZE} executors`);
      console.log(`  - Contract epoch incremented to ${finalEpoch}`);
    } else if (success && !goodDistribution) {
      console.log('\n⚠ POC partially successful (load not well distributed)');
      console.log(
        `  - All effects processed but only ${activeExecutors}/${POOL_SIZE} executors used`
      );
      console.log('  - This may happen with small workloads; not a failure');
    } else {
      console.log('\n✗ POC failed!');
      if (finalState.eventsProcessed !== NUM_EVENTS) {
        console.log(
          `  - Expected ${NUM_EVENTS} events, got ${finalState.eventsProcessed}`
        );
      }
      if (poolStats.totalFailed > 0) {
        console.log(`  - ${poolStats.totalFailed} effects failed`);
      }
      process.exit(1);
    }
  } finally {
    // Cleanup
    console.log('\nCleaning up...');

    if (executorPool) {
      await executorPool.stop();
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
