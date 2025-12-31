/**
 * Durable Await Pattern - Proof of Concept (Multiple Effects)
 *
 * This script demonstrates the core execution loop with multiple sequential effects:
 *   simulate → catch EffectNeeded → execute effect → submit result → resimulate → repeat → commit
 *
 * The strategy emits 4 LOG effects per step, demonstrating that:
 * - Each effect is handled sequentially
 * - State changes (eventsProcessed counter) only persist after final commit
 * - The loop correctly handles an arbitrary number of effects
 *
 * Usage:
 *   1. Start the Geth node: npm run up
 *   2. Build contracts: npm run build:contracts
 *   3. Run this script: npm run poc:loop
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
  parseEffectNeededFromError,
  decodeLogPayload,
  executeLogEffect,
  isLogEffect,
  EFFECT_LOG,
  type EffectRequest,
} from './effect-parser.js';

// ============================================================
// Configuration
// ============================================================

// Foundry account #0 (pre-funded in genesis)
const OPERATOR_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const OPERATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

// Chain configuration (matches genesis)
const CHAIN_ID = 31337;
const RPC_URL = 'http://localhost:8545';

// Event type for our test
const PING_EVENT_TYPE = keccak256(toHex('PING'));

// ============================================================
// Setup
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Custom chain definition for local Geth
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

/**
 * Load compiled contract bytecode from Foundry artifacts.
 */
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

/**
 * Deploy the SimpleLoggingStrategy contract.
 */
async function deployStrategy(): Promise<Address> {
  console.log('Deploying SimpleLoggingStrategy...');

  const bytecode = loadBytecode();

  // Encode constructor arguments: (operator, core)
  // For POC, operator and core are the same address
  const encodedArgs = encodeAbiParameters(
    [
      { type: 'address', name: 'operator_' },
      { type: 'address', name: 'core_' },
    ],
    [OPERATOR_ADDRESS, OPERATOR_ADDRESS]
  );

  // Combine bytecode + encoded args
  const deployData = (bytecode + encodedArgs.slice(2)) as Hex;

  const hash = await walletClient.deployContract({
    abi: SimpleLoggingStrategyAbi,
    bytecode: deployData,
    args: [],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error('Contract deployment failed - no address in receipt');
  }

  console.log(`Strategy deployed at: ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

// ============================================================
// StepEvent Encoding
// ============================================================

/**
 * Encode a StepEvent envelope.
 *
 * Format: abi.encode(eventType, eventVersion, payload)
 */
function encodeStepEvent(
  eventType: Hex,
  eventVersion: number,
  payload: Hex = '0x'
): Hex {
  return encodeAbiParameters(
    [
      { type: 'bytes32', name: 'eventType' },
      { type: 'uint32', name: 'eventVersion' },
      { type: 'bytes', name: 'payload' },
    ],
    [eventType, eventVersion, payload]
  );
}

// ============================================================
// Durable Await Loop
// ============================================================

/**
 * Execute the durable await loop for a single event.
 *
 * This is the core pattern:
 * 1. Simulate step()
 * 2. If EffectNeeded, execute effect and submit result
 * 3. Repeat until simulation succeeds
 * 4. Commit the transaction
 *
 * Returns the number of effects that were processed.
 */
async function executeDurableAwaitLoop(
  strategyAddress: Address,
  stepInput: Hex
): Promise<number> {
  let iteration = 0;
  let effectsProcessed = 0;
  const maxIterations = 20; // Safety limit (increased for multiple effects)

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n[Simulation ${iteration}]`);

    try {
      // Attempt to simulate step()
      await publicClient.simulateContract({
        address: strategyAddress,
        abi: SimpleLoggingStrategyAbi,
        functionName: 'step',
        args: [stepInput],
        account: OPERATOR_ADDRESS,
      });

      // Simulation succeeded - commit the transaction
      console.log('✓ Simulation succeeded! All effects resolved.');
      console.log('\nCommitting transaction...');

      const hash = await walletClient.writeContract({
        address: strategyAddress,
        abi: SimpleLoggingStrategyAbi,
        functionName: 'step',
        args: [stepInput],
      });

      console.log(`TX hash: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log('Transaction committed!');
      return effectsProcessed;
    } catch (error) {
      // Check if this is an EffectNeeded revert
      const effect = parseEffectNeededFromError(error);

      if (!effect) {
        // Not an EffectNeeded error - something else went wrong
        console.error('Simulation failed with unexpected error:');
        throw error;
      }

      effectsProcessed++;
      console.log(`Effect #${effectsProcessed} needed:`);
      console.log(`  epoch: ${effect.epoch}`);
      console.log(`  key: ${effect.idempotencyKey.slice(0, 18)}...`);

      // Execute the effect
      await executeEffect(strategyAddress, effect);
    }
  }

  throw new Error(`Exceeded maximum iterations (${maxIterations})`);
}

/**
 * Execute an effect and submit its result.
 */
async function executeEffect(
  strategyAddress: Address,
  effect: EffectRequest
): Promise<void> {
  console.log('\nExecuting effect...');

  let resultData: Hex = '0x';

  if (isLogEffect(effect.effectType)) {
    // LOG effect - decode and print
    const logPayload = decodeLogPayload(effect.payload);
    executeLogEffect(logPayload);
    // LOG effects return empty data
    resultData = '0x';
  } else {
    console.log(`  Unknown effect type: ${effect.effectType}`);
    // For unknown effects, we still submit success with empty data
    // In production, this would be an error
  }

  // Submit the effect result
  console.log('\nSubmitting effect result...');

  const hash = await walletClient.writeContract({
    address: strategyAddress,
    abi: SimpleLoggingStrategyAbi,
    functionName: 'submitEffectResult',
    args: [effect.epoch, effect.idempotencyKey, true, resultData],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  console.log('Effect result submitted.');
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Durable Await Pattern - Multiple Effects POC');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check connection
  try {
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`Connected to Geth node. Block number: ${blockNumber}\n`);
  } catch {
    console.error('Failed to connect to Geth node.');
    console.error('Make sure the node is running: npm run up');
    process.exit(1);
  }

  // Deploy strategy
  const strategyAddress = await deployStrategy();

  // Check initial state
  const initialEpoch = await publicClient.readContract({
    address: strategyAddress,
    abi: SimpleLoggingStrategyAbi,
    functionName: 'epoch',
  });
  const initialEventsProcessed = await publicClient.readContract({
    address: strategyAddress,
    abi: SimpleLoggingStrategyAbi,
    functionName: 'eventsProcessed',
  });
  console.log(`Initial epoch: ${initialEpoch}`);
  console.log(`Initial eventsProcessed: ${initialEventsProcessed}`);

  // Encode a PING event
  console.log('\n───────────────────────────────────────────────────────────');
  console.log('Sending PING event (expects 4 LOG effects)...');
  console.log('───────────────────────────────────────────────────────────');

  const pingEvent = encodeStepEvent(PING_EVENT_TYPE, 1, '0x');

  // Run the durable await loop
  const effectCount = await executeDurableAwaitLoop(strategyAddress, pingEvent);

  // Verify final state
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
  console.log(`  Effects processed: ${effectCount}`);
  console.log(`  Epoch: ${initialEpoch} → ${finalEpoch}`);
  console.log(`  eventsProcessed: ${initialEventsProcessed} → ${finalEventsProcessed}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Validate results
  const success = finalEpoch === 1n && finalEventsProcessed === 1n && effectCount === 4;

  if (success) {
    console.log('\n✓ POC successful!');
    console.log('  - 4 effects handled in sequence');
    console.log('  - Epoch incremented from 0 to 1');
    console.log('  - eventsProcessed counter updated (state persisted on commit)');
  } else {
    console.log('\n✗ POC failed!');
    if (effectCount !== 4) console.log(`  Expected 4 effects, got ${effectCount}`);
    if (finalEpoch !== 1n) console.log(`  Expected epoch=1, got ${finalEpoch}`);
    if (finalEventsProcessed !== 1n) console.log(`  Expected eventsProcessed=1, got ${finalEventsProcessed}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
