/**
 * Generate MidcurveTreasury + MidcurveTreasuryFactory ABIs for @midcurve/shared
 *
 * `out/` is gitignored, so these are committed as generated TypeScript.
 *
 * Usage:
 *   cd apps/midcurve-contracts
 *   forge build
 *   pnpm gen:treasury-artifacts
 *
 * No creation bytecode is emitted. Instances are deployed by calling
 * createTreasury() on the chain's registered factory, so nothing outside this
 * package needs to know how to construct one — which also retires the hazard
 * the old bytecode constant carried, where a stale copy deployed the wrong
 * contract without failing.
 *
 * A stale ABI is milder but still wrong, so CI runs this and fails on a dirty
 * tree; see .github/workflows/pr-tests.yml.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SHARED_ABIS = resolve(__dirname, '../../../packages/midcurve-shared/src/abis');

interface ForgeArtifact {
  abi: unknown[];
  metadata?: { compiler?: { version?: string } };
}

interface Target {
  /** Solidity contract name, and the forge artifact directory it lands in */
  contract: string;
  /** Source path, for the generated banner */
  source: string;
  /** Output directory under packages/midcurve-shared/src/abis */
  outputDir: string;
  /** Exported constant name */
  constName: string;
  /** Exported type alias name */
  typeName: string;
  /** Doc comment for the exported constant */
  doc: string;
}

const TARGETS: Target[] = [
  {
    contract: 'MidcurveTreasury',
    source: 'apps/midcurve-contracts/contracts/treasury/MidcurveTreasury.sol',
    outputDir: 'midcurve-treasury',
    constName: 'MIDCURVE_TREASURY_ABI',
    typeName: 'MidcurveTreasuryAbi',
    doc: `MidcurveTreasury ABI.
 *
 * Used by the readiness check to read admin(), operator(), weth() and
 * swapRouter() off a candidate treasury before registering it.`,
  },
  {
    contract: 'MidcurveTreasuryFactory',
    source: 'apps/midcurve-contracts/contracts/treasury/MidcurveTreasuryFactory.sol',
    outputDir: 'midcurve-treasury-factory',
    constName: 'MIDCURVE_TREASURY_FACTORY_ABI',
    typeName: 'MidcurveTreasuryFactoryAbi',
    doc: `MidcurveTreasuryFactory ABI.
 *
 * Used to encode the createTreasury() call the kickstart sends, to predict an
 * instance's address before that transaction, and to test provenance with
 * isTreasury() when registering one.`,
  },
];

function banner(source: string, compilerVersion: string): string {
  return `// ============================================================================
// GENERATED FILE — DO NOT EDIT
//
// Source:   ${source}
// Compiler: solc ${compilerVersion}
// Regenerate: cd apps/midcurve-contracts && forge build && pnpm gen:treasury-artifacts
// ============================================================================
`;
}

function generate(target: Target): number {
  const artifact: ForgeArtifact = JSON.parse(
    readFileSync(
      resolve(__dirname, `../out/${target.contract}.sol/${target.contract}.json`),
      'utf-8',
    ),
  );

  const compilerVersion = artifact.metadata?.compiler?.version ?? 'unknown';
  const outputDir = resolve(SHARED_ABIS, target.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const abiSource = `${banner(target.source, compilerVersion)}
/**
 * ${target.doc}
 */
export const ${target.constName} = ${JSON.stringify(artifact.abi, null, 2)} as const;

export type ${target.typeName} = typeof ${target.constName};
`;

  const indexSource = `export * from './abi.js';\n`;

  writeFileSync(resolve(outputDir, 'abi.ts'), abiSource);
  writeFileSync(resolve(outputDir, 'index.ts'), indexSource);

  console.log(`  + ${target.contract}: ${artifact.abi.length} ABI entries -> ${target.outputDir}/`);
  return artifact.abi.length;
}

function main(): void {
  console.log('=== Treasury artifacts ===');
  for (const target of TARGETS) {
    generate(target);
  }
}

main();
