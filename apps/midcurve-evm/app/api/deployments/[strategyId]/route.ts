/**
 * GET /api/deployments/{deploymentId} - Get deployment status
 *
 * Always returns 200 OK if the deployment exists (status is in the body, not HTTP code).
 * Returns 404 if no deployment exists for this deploymentId.
 *
 * Response (200):
 * {
 *   deploymentId: string,
 *   status: "pending" | "signing" | "broadcasting" | "confirming" | "setting_up_topology" | "completed" | "failed",
 *   contractAddress: string | null,
 *   txHash: string | null,
 *   startedAt: string (ISO),
 *   completedAt: string | null (ISO),
 *   error: string | null,
 *   // Deployment request data (for strategy creation)
 *   manifest: object | null,
 *   name: string | null,
 *   userId: string | null,
 *   quoteTokenId: string | null,
 *   constructorValues: object | null,
 *   strategyCreated: boolean,
 *   strategyId: string | null
 * }
 *
 * Response (404):
 * {
 *   error: "Deployment not found"
 * }
 */

import { NextResponse } from 'next/server';
import { getDeploymentService } from '../../../../core/src/services/deployment-service';
import { logger } from '../../../../lib/logger';

const log = logger.child({ route: 'GET /api/deployments/[strategyId]' });

// =============================================================================
// Handler
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ strategyId: string }> }
) {
  try {
    // Note: URL param is still called strategyId for compatibility,
    // but internally it's the deploymentId
    const { strategyId: deploymentId } = await params;

    const deploymentService = getDeploymentService();
    const state = await deploymentService.getDeploymentState(deploymentId);

    if (!state) {
      return NextResponse.json(
        { error: 'Deployment not found' },
        { status: 404 }
      );
    }

    // Always return 200 OK - status is in the body, not the HTTP code
    // This is the REST standard for async operations:
    // - 202: Only for accepting new work (POST)
    // - 200: Resource exists (GET), regardless of operation status
    // - 404: Resource doesn't exist
    // - 500: Only for actual server errors (bugs)
    return NextResponse.json(
      {
        deploymentId: state.deploymentId,
        status: state.status,
        contractAddress: state.contractAddress ?? null,
        txHash: state.txHash ?? null,
        startedAt: state.startedAt,
        completedAt: state.completedAt ?? null,
        error: state.error ?? null,
        // Include deployment request data for strategy creation by API
        manifest: state.manifest ?? null,
        name: state.name ?? null,
        userId: state.userId ?? null,
        quoteTokenId: state.quoteTokenId ?? null,
        constructorValues: state.constructorValues ?? null,
        // Automation wallet info (created by signer during signing)
        automationWallet: state.automationWallet ?? null,
        strategyCreated: state.strategyCreated ?? false,
        strategyId: state.strategyId ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    log.error({ error, msg: 'Error getting deployment status' });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
