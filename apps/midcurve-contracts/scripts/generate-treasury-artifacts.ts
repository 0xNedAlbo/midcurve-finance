/**
 * Generate MidcurveTreasury ABI + creation bytecode for @midcurve/shared
 *
 * The gas readiness gate deploys MidcurveTreasury from the user's browser, so
 * the creation bytecode has to be in the frontend bundle. `out/` is gitignored,
 * so the artifact is committed as generated TypeScript instead.
 *
 * Usage:
 *   cd apps/midcurve-contracts
 *   forge build
 *   pnpm gen:treasury-artifacts
 *
 * A stale bytecode constant does not fail loudly — it deploys the wrong
 * contract. CI runs this and fails on a dirty tree; see .github/workflows/pr-tests.yml.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ARTIFACT_PATH = resolve(
  __dirname,
  '../out/MidcurveTreasury.sol/MidcurveTreasury.json',
);

const OUTPUT_DIR = resolve(
  __dirname,
  '../../../packages/midcurve-shared/src/abis/midcurve-treasury',
);

interface ForgeArtifact {
  abi: unknown[];
  bytecode: { object: string; linkReferences: Record<string, unknown> };
  metadata?: { compiler?: { version?: string } };
}

function banner(compilerVersion: string): string {
  return `// ============================================================================
// GENERATED FILE — DO NOT EDIT
//
// Source:   apps/midcurve-contracts/contracts/treasury/MidcurveTreasury.sol
// Compiler: solc ${compilerVersion}
// Regenerate: cd apps/midcurve-contracts && forge build && pnpm gen:treasury-artifacts
// ============================================================================
`;
}

function main(): void {
  const artifact: ForgeArtifact = JSON.parse(
    readFileSync(ARTIFACT_PATH, 'utf-8'),
  );

  const compilerVersion = artifact.metadata?.compiler?.version ?? 'unknown';

  // A library-linked bytecode object carries placeholders that cannot be
  // deployed as-is. MidcurveTreasury has no libraries; fail loudly if that changes.
  const linkCount = Object.keys(artifact.bytecode.linkReferences).length;
  if (linkCount > 0) {
    throw new Error(
      `MidcurveTreasury bytecode has ${linkCount} unresolved link reference(s). ` +
        'Library linking is not supported by the browser deploy path.',
    );
  }

  if (!/^0x[0-9a-fA-F]+$/.test(artifact.bytecode.object)) {
    throw new Error('Bytecode object is not well-formed 0x-prefixed hex');
  }

  const abiSource = `${banner(compilerVersion)}
/**
 * MidcurveTreasury ABI.
 *
 * Used by the readiness check to read admin(), operator(), weth() and
 * swapRouter() off a candidate treasury before registering it.
 */
export const MIDCURVE_TREASURY_ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;

export type MidcurveTreasuryAbi = typeof MIDCURVE_TREASURY_ABI;
`;

  const bytecodeSource = `${banner(compilerVersion)}
import type { Hex } from 'viem';

/**
 * MidcurveTreasury creation bytecode, without constructor arguments.
 *
 * Build a deployable init code with buildTreasuryInitCode() from
 * utils/evm/treasury-deploy.ts rather than concatenating by hand.
 */
export const MIDCURVE_TREASURY_CREATION_BYTECODE: Hex =
  '${artifact.bytecode.object}';
`;

  writeFileSync(resolve(OUTPUT_DIR, 'abi.ts'), abiSource);
  writeFileSync(resolve(OUTPUT_DIR, 'bytecode.ts'), bytecodeSource);

  const byteLength = (artifact.bytecode.object.length - 2) / 2;
  console.log('=== MidcurveTreasury artifacts generated ===');
  console.log('  solc:      ', compilerVersion);
  console.log('  abi entries:', artifact.abi.length);
  console.log('  bytecode:  ', `${byteLength} bytes`);
  console.log('  output:    ', OUTPUT_DIR);
}

main();
