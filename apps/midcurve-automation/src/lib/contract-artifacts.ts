/**
 * Contract Artifacts Loader
 *
 * Loads compiled contract artifacts from the artifacts/ directory.
 * Artifacts are cached in memory after first load.
 */

import fs from 'fs';
import path from 'path';
import type { Hex, Abi } from 'viem';

interface CompiledArtifact {
  contractName: string;
  abi: Abi;
  bytecode: { object: string };
  deployedBytecode: { object: string };
  compiler: {
    version: string;
    settings: unknown;
  };
  compiledAt: string;
}

// Cache for loaded artifacts
const artifactCache: Map<string, CompiledArtifact> = new Map();

/**
 * Get the artifacts directory path
 */
function getArtifactsDir(): string {
  return path.join(process.cwd(), 'artifacts');
}

/**
 * Load a contract artifact from file
 */
function loadArtifact(contractName: string): CompiledArtifact {
  // Check cache first
  const cached = artifactCache.get(contractName);
  if (cached) {
    return cached;
  }

  const artifactPath = path.join(getArtifactsDir(), contractName + '.json');

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      'Contract artifact not found: ' + contractName + '. ' +
      'Run "pnpm compile" to compile contracts first.'
    );
  }

  const content = fs.readFileSync(artifactPath, 'utf-8');
  const artifact: CompiledArtifact = JSON.parse(content);

  // Validate artifact structure
  if (!artifact.bytecode?.object) {
    throw new Error('Invalid artifact: missing bytecode for ' + contractName);
  }

  if (!artifact.abi) {
    throw new Error('Invalid artifact: missing ABI for ' + contractName);
  }

  // Cache and return
  artifactCache.set(contractName, artifact);
  return artifact;
}

/**
 * Get the UniswapV3PositionCloser bytecode
 */
export function getPositionCloserBytecode(): Hex {
  const artifact = loadArtifact('UniswapV3PositionCloser');
  return artifact.bytecode.object as Hex;
}

/**
 * Get the UniswapV3PositionCloser ABI
 */
export function getPositionCloserAbi(): Abi {
  const artifact = loadArtifact('UniswapV3PositionCloser');
  return artifact.abi;
}

/**
 * Get the full UniswapV3PositionCloser artifact
 */
export function getPositionCloserArtifact(): CompiledArtifact {
  return loadArtifact('UniswapV3PositionCloser');
}

/**
 * Check if artifacts are available
 */
export function areArtifactsAvailable(): boolean {
  try {
    const artifactPath = path.join(getArtifactsDir(), 'UniswapV3PositionCloser.json');
    return fs.existsSync(artifactPath);
  } catch {
    return false;
  }
}

/**
 * Clear the artifact cache (useful for development/testing)
 */
export function clearArtifactCache(): void {
  artifactCache.clear();
}
