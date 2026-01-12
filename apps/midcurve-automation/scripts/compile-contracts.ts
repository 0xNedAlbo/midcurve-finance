/**
 * Contract Compilation Script
 *
 * Compiles Solidity contracts using solc and outputs artifacts to the artifacts/ directory.
 * Run with: pnpm compile (or tsx scripts/compile-contracts.ts)
 */

import solc from 'solc';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTRACTS_DIR = path.join(__dirname, '../contracts');
const ARTIFACTS_DIR = path.join(__dirname, '../artifacts');

interface SolcInput {
  language: string;
  sources: Record<string, { content: string }>;
  settings: {
    optimizer: { enabled: boolean; runs: number };
    evmVersion: string;
    viaIR?: boolean;
    outputSelection: Record<string, Record<string, string[]>>;
  };
}

interface SolcOutput {
  errors?: Array<{
    severity: string;
    message: string;
    formattedMessage?: string;
  }>;
  contracts?: Record<string, Record<string, {
    abi: unknown[];
    evm: {
      bytecode: { object: string };
      deployedBytecode: { object: string };
    };
  }>>;
}

/**
 * Import callback for solc to resolve imports from local files
 */
function findImports(importPath: string): { contents: string } | { error: string } {
  try {
    // Normalize the path - remove leading ./ if present
    const normalizedPath = importPath.startsWith('./') ? importPath.slice(2) : importPath;

    // Handle relative imports (e.g., ./interfaces/IParaswap.sol -> interfaces/IParaswap.sol)
    const fullPath = path.join(CONTRACTS_DIR, normalizedPath);
    if (fs.existsSync(fullPath)) {
      return { contents: fs.readFileSync(fullPath, 'utf8') };
    }
    return { error: 'File not found: ' + importPath + ' (resolved to: ' + fullPath + ')' };
  } catch (error) {
    return { error: 'Error reading file: ' + importPath };
  }
}

function compileContract(contractName: string): void {
  const contractPath = path.join(CONTRACTS_DIR, contractName + '.sol');
  const outputPath = path.join(ARTIFACTS_DIR, contractName + '.json');

  console.log('Compiling ' + contractName + '.sol...');

  if (!fs.existsSync(contractPath)) {
    console.error('Error: Contract file not found: ' + contractPath);
    process.exit(1);
  }

  const source = fs.readFileSync(contractPath, 'utf8');

  const input: SolcInput = {
    language: 'Solidity',
    sources: {
      [contractName + '.sol']: { content: source }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      viaIR: true,
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']
        }
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output: SolcOutput = JSON.parse((solc as any).compile(JSON.stringify(input), { import: findImports }));

  // Check for errors
  if (output.errors) {
    const errors = output.errors.filter(e => e.severity === 'error');
    const warnings = output.errors.filter(e => e.severity === 'warning');

    if (warnings.length > 0) {
      console.log('\nWarnings:');
      warnings.forEach(w => console.log('  - ' + w.message));
    }

    if (errors.length > 0) {
      console.error('\nCompilation errors:');
      errors.forEach(e => console.error('  - ' + (e.formattedMessage || e.message)));
      process.exit(1);
    }
  }

  if (!output.contracts) {
    console.error('Error: No contracts found in compilation output');
    process.exit(1);
  }

  const contractKey = contractName + '.sol';
  const contract = output.contracts[contractKey]?.[contractName];
  if (!contract) {
    console.error('Error: Contract ' + contractName + ' not found in compilation output');
    console.error('Available contracts:', Object.keys(output.contracts[contractKey] || {}));
    process.exit(1);
  }

  const bytecodeHex = contract.evm.bytecode.object;
  if (!bytecodeHex || bytecodeHex === '') {
    console.error('Error: Compiled bytecode is empty');
    process.exit(1);
  }

  const artifact = {
    contractName,
    abi: contract.abi,
    bytecode: {
      object: bytecodeHex.startsWith('0x') ? bytecodeHex : '0x' + bytecodeHex
    },
    deployedBytecode: {
      object: contract.evm.deployedBytecode.object.startsWith('0x')
        ? contract.evm.deployedBytecode.object
        : '0x' + contract.evm.deployedBytecode.object
    },
    compiler: {
      version: solc.version(),
      settings: input.settings
    },
    compiledAt: new Date().toISOString()
  };

  // Ensure artifacts directory exists
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // Write artifact
  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));

  const bytecodeSize = (bytecodeHex.length / 2).toLocaleString();
  console.log('  ✓ Compiled successfully');
  console.log('  ✓ Bytecode size: ' + bytecodeSize + ' bytes');
  console.log('  ✓ Output: ' + path.relative(process.cwd(), outputPath));
}

// Main
console.log('='.repeat(60));
console.log('Midcurve Automation - Contract Compilation');
console.log('='.repeat(60));
console.log();

compileContract('UniswapV3PositionCloser');

console.log();
console.log('='.repeat(60));
console.log('Compilation complete!');
console.log('='.repeat(60));
