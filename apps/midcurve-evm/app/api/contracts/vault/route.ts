/**
 * GET /api/contracts/vault - Return SimpleTokenVault contract info
 *
 * This endpoint provides the bytecode and ABI for the SimpleTokenVault contract,
 * which is used by the frontend to deploy vaults from the user's wallet.
 *
 * Response:
 * {
 *   bytecode: string,  // 0x-prefixed contract bytecode
 *   abi: unknown[]     // Contract ABI
 * }
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface FoundryArtifact {
  bytecode: {
    object: string;
  };
  abi: unknown[];
}

export async function GET() {
  try {
    // Read the Foundry artifact
    const artifactPath = path.resolve(
      process.cwd(),
      'contracts/out/SimpleTokenVault.sol/SimpleTokenVault.json'
    );

    if (!fs.existsSync(artifactPath)) {
      return NextResponse.json(
        { error: 'Vault contract artifact not found. Run forge build first.' },
        { status: 500 }
      );
    }

    const artifact: FoundryArtifact = JSON.parse(
      fs.readFileSync(artifactPath, 'utf-8')
    );

    // Extract bytecode and ABI
    let bytecode = artifact.bytecode.object;
    if (!bytecode.startsWith('0x')) {
      bytecode = '0x' + bytecode;
    }

    return NextResponse.json({
      bytecode,
      abi: artifact.abi,
    });
  } catch (error) {
    console.error('Failed to read vault contract artifact:', error);
    return NextResponse.json(
      {
        error: 'Failed to read vault contract artifact',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
