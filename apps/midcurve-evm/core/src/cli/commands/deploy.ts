import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { semseeChain } from '../../vm/chain.js';
import { CORE_PRIVATE_KEY } from '../../utils/addresses.js';
import { STRATEGY_ABI, STRATEGY_STATES } from '../abis.js';

export const deployCommand = new Command('deploy')
  .description('Compile and deploy a strategy contract')
  .argument('<path>', 'Path to strategy .sol file (relative to current directory)')
  .option('-n, --name <name>', 'Contract name (default: extracted from file)')
  .option('-s, --start', 'Start the strategy after deployment')
  .option('-k, --key <privateKey>', 'Private key of deployer/owner (default: OWNER_PRIVATE_KEY env var)', process.env.OWNER_PRIVATE_KEY)
  .action(async (pathArg: string, options: { name?: string; start?: boolean; key?: string }) => {
    // Resolve the path relative to original working directory (before cd into core/)
    const cwd = process.env.SEMSEE_CWD || process.cwd();
    const fullPath = resolve(cwd, pathArg);

    // Verify the file exists
    if (!existsSync(fullPath)) {
      console.error(`\n❌ Strategy file not found: ${fullPath}`);
      process.exit(1);
    }

    // Extract contract name from file if not provided
    let contractName = options.name;
    if (!contractName) {
      // Try to extract from filename first (e.g., MyStrategy.sol -> MyStrategy)
      const filename = basename(fullPath, '.sol');

      // Verify the contract exists in the file
      const fileContent = readFileSync(fullPath, 'utf-8');
      const contractMatch = fileContent.match(/contract\s+(\w+)/);

      if (contractMatch) {
        contractName = contractMatch[1];
      } else {
        contractName = filename;
      }
    }

    // Find the contracts directory by looking for foundry.toml
    let contractsDir = dirname(fullPath);
    while (contractsDir !== '/' && !existsSync(resolve(contractsDir, 'foundry.toml'))) {
      contractsDir = dirname(contractsDir);
    }

    if (!existsSync(resolve(contractsDir, 'foundry.toml'))) {
      console.error(`\n❌ Could not find foundry.toml in parent directories`);
      console.error(`   Make sure you're in a Foundry project`);
      process.exit(1);
    }

    // Get the relative path from contracts dir to the strategy file
    const relativePath = fullPath.replace(contractsDir + '/', '');

    console.log(`\n🔨 Building contracts...`);

    try {
      // Build contracts
      execSync('forge build', {
        cwd: contractsDir,
        stdio: 'inherit',
      });
    } catch {
      console.error(`\n❌ Build failed`);
      process.exit(1);
    }

    // Determine which private key to use for deployment
    const deployerKey = (options.key as Hex) || CORE_PRIVATE_KEY;

    console.log(`\n📦 Deploying ${contractName}...`);

    try {
      // Deploy using forge create
      const result = spawnSync(
        'forge',
        [
          'create',
          `${relativePath}:${contractName}`,
          '--rpc-url', 'http://localhost:8545',
          '--private-key', deployerKey,
          '--json',
        ],
        {
          cwd: contractsDir,
          encoding: 'utf-8',
        }
      );

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        console.error(result.stderr);
        throw new Error('Deployment failed');
      }

      // Parse JSON output
      const output = JSON.parse(result.stdout);
      const deployedAddress = output.deployedTo as Address;

      console.log(`\n✅ Deployed to: ${deployedAddress}`);

      // Show strategy status
      const client = createPublicClient({
        chain: semseeChain,
        transport: http(),
      });

      const [owner, state] = await Promise.all([
        client.readContract({
          address: deployedAddress,
          abi: STRATEGY_ABI,
          functionName: 'owner',
        }),
        client.readContract({
          address: deployedAddress,
          abi: STRATEGY_ABI,
          functionName: 'state',
        }),
      ]);

      console.log(`   Owner: ${owner}`);
      console.log(`   State: ${STRATEGY_STATES[Number(state)]}`);

      // Optionally start the strategy
      if (options.start) {
        console.log(`\n▶️  Starting strategy...`);

        const { createWalletClient } = await import('viem');
        const { privateKeyToAccount } = await import('viem/accounts');

        // Use the same key that deployed (owner)
        const account = privateKeyToAccount(deployerKey);
        const walletClient = createWalletClient({
          account,
          chain: semseeChain,
          transport: http(),
        });

        const hash = await walletClient.writeContract({
          address: deployedAddress,
          abi: STRATEGY_ABI,
          functionName: 'start',
        });

        const receipt = await client.waitForTransactionReceipt({ hash });

        if (receipt.status === 'success') {
          console.log(`✅ Started!`);
        } else {
          console.error(`❌ Failed to start strategy`);
        }
      }

      console.log(`\nNext steps:`);
      if (!options.start) {
        console.log(`  npm run strategy:start ${deployedAddress}`);
      }
      console.log(`  npm run strategy:logs ${deployedAddress}`);
      console.log(`  npm run strategy:status ${deployedAddress}`);
      console.log('');
    } catch (error) {
      if (error instanceof Error) {
        console.error(`\n❌ Deployment error: ${error.message}`);
      } else {
        console.error('\n❌ Unknown deployment error');
      }
      process.exit(1);
    }
  });
