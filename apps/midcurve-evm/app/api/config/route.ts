/**
 * GET /api/config - Return chain configuration
 *
 * This endpoint exposes chain-specific configuration needed by other services.
 * Specifically, the Core contract address used as a constructor parameter for strategies.
 *
 * Response:
 * {
 *   coreAddress: string,  // Core orchestrator contract address
 *   chainId: number       // Chain ID (31337 for SEMSEE)
 * }
 */

import { NextResponse } from 'next/server';

/**
 * SEMSEE chain ID
 */
const SEMSEE_CHAIN_ID = 31337;

export async function GET() {
  const coreAddress = process.env.CORE_ADDRESS;

  if (!coreAddress) {
    return NextResponse.json(
      { error: 'CORE_ADDRESS not configured' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    coreAddress,
    chainId: SEMSEE_CHAIN_ID,
  });
}
