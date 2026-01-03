/**
 * Contract Bytecode API Endpoint
 *
 * GET /api/contracts/bytecode - Returns compiled contract bytecode
 *
 * This is an internal API endpoint that serves contract bytecode and ABI
 * to the midcurve-api service. No authentication is required as contract
 * bytecode is public information.
 *
 * Query Parameters:
 * - contractType: 'uniswapv3' (required)
 *
 * Response:
 * - 200: { success: true, data: { contractType, bytecode, abi } }
 * - 400: { success: false, error: 'Unsupported contract type' }
 * - 500: { success: false, error: 'Bytecode not available' }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getPositionCloserBytecode,
  getPositionCloserAbi,
  areArtifactsAvailable,
} from '@/lib/contract-artifacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/contracts/bytecode
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const contractType = searchParams.get('contractType');

  // Validate contract type
  if (!contractType) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing required query parameter: contractType',
      },
      { status: 400 }
    );
  }

  // Only uniswapv3 supported for now
  if (contractType !== 'uniswapv3') {
    return NextResponse.json(
      {
        success: false,
        error: 'Unsupported contract type: ' + contractType + '. Supported: uniswapv3',
      },
      { status: 400 }
    );
  }

  // Check if artifacts are available
  if (!areArtifactsAvailable()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Contract artifacts not available. Run "pnpm compile" first.',
      },
      { status: 500 }
    );
  }

  try {
    const bytecode = getPositionCloserBytecode();
    const abi = getPositionCloserAbi();

    return NextResponse.json({
      success: true,
      data: {
        contractType,
        bytecode,
        abi,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error loading contract artifact:', message);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load contract bytecode: ' + message,
      },
      { status: 500 }
    );
  }
}
