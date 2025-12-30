/**
 * Strategy Deployment Status Endpoint
 *
 * GET /api/v1/strategies/deploy/{deploymentId}
 *
 * Authentication: Required (session only)
 *
 * This endpoint:
 * 1. Polls deployment status from the EVM service
 * 2. When status is 'completed', creates the Strategy record in the database
 * 3. Returns the current deployment status
 *
 * The Strategy is ONLY created after successful deployment to prevent
 * orphan "deploying" strategies from failed deployments.
 *
 * REST Standard Pattern:
 * - Always returns 200 OK if the deployment exists (status is in the body, not HTTP code)
 * - Returns 404 if no deployment exists
 * - 500 is reserved for actual server errors (bugs), not deployment failures
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSessionAuth } from '@/middleware/with-session-auth';
import { createPreflightResponse } from '@/lib/cors';

import {
  createErrorResponse,
  createSuccessResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import type { StrategyManifest } from '@midcurve/shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { StrategyService, CacheService } from '@midcurve/services';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * EVM service response type (extended with deployment request data)
 */
interface EvmDeploymentStatus {
  deploymentId: string;
  status: 'pending' | 'signing' | 'broadcasting' | 'confirming' | 'setting_up_topology' | 'completed' | 'failed';
  contractAddress: string | null;
  txHash: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  // Deployment request data (from cache, for strategy creation)
  manifest: StrategyManifest | null;
  name: string | null;
  userId: string | null;
  quoteTokenId: string | null;
  constructorValues: Record<string, string> | null;
  // Automation wallet info (created by signer)
  automationWallet: {
    walletAddress: string;
    kmsKeyId: string;
    /** Encrypted private key for LocalDevSigner persistence */
    encryptedPrivateKey?: string;
    /** Key provider type (aws-kms or local-encrypted) */
    keyProvider: 'aws-kms' | 'local-encrypted';
  } | null;
  strategyCreated: boolean;
  strategyId: string | null;
}

/**
 * TTL for deployment cache entries: 24 hours
 */
const DEPLOYMENT_TTL_SECONDS = 24 * 60 * 60;

/**
 * OPTIONS /api/v1/strategies/deploy/{strategyId}
 *
 * CORS preflight handler
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/v1/strategies/deploy/{deploymentId}
 *
 * Poll deployment status from the EVM service.
 * When deployment completes successfully, creates the Strategy record.
 *
 * Always returns 200 OK if the deployment exists - status is in the body.
 * This is the REST standard for async operations.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ strategyId: string }> }
): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Note: URL param is called strategyId but it's actually the deploymentId
      const { strategyId: deploymentId } = await params;

      apiLog.businessOperation(
        apiLogger,
        requestId,
        'poll-deployment-status',
        'deployment',
        deploymentId,
        { userId: user.id }
      );

      // Call EVM service to get deployment status
      const evmServiceUrl = process.env.EVM_SERVICE_URL || 'http://localhost:3002';

      let evmResponse: Response;
      try {
        evmResponse = await fetch(
          `${evmServiceUrl}/api/deployments/${deploymentId}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } catch (error: unknown) {
        apiLogger.error(
          {
            requestId,
            deploymentId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to connect to EVM service'
        );

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          'Failed to connect to EVM service'
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // Handle 404 - no deployment found
      if (evmResponse.status === 404) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'No deployment found'
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 404 });
      }

      const evmData = (await evmResponse.json()) as EvmDeploymentStatus;

      apiLogger.info(
        {
          requestId,
          deploymentId,
          status: evmData.status,
          isCompleted: evmData.status === 'completed',
          isFailed: evmData.status === 'failed',
          strategyCreated: evmData.strategyCreated,
        },
        'Deployment status retrieved'
      );

      // If deployment completed successfully and Strategy not yet created, create it now
      let strategyId = evmData.strategyId;
      if (
        evmData.status === 'completed' &&
        !evmData.strategyCreated &&
        evmData.manifest &&
        evmData.name &&
        evmData.userId &&
        evmData.quoteTokenId &&
        evmData.contractAddress &&
        evmData.automationWallet // Automation wallet must exist (created by signer)
      ) {
        apiLogger.info(
          {
            requestId,
            deploymentId,
            contractAddress: evmData.contractAddress,
            automationWalletAddress: evmData.automationWallet.walletAddress,
          },
          'Creating Strategy record after successful deployment'
        );

        try {
          const strategyService = new StrategyService();

          // Create strategy in pending state
          const strategy = await strategyService.create({
            userId: evmData.userId,
            name: evmData.name,
            strategyType: evmData.manifest.name || 'custom',
            config: {
              constructorValues: evmData.constructorValues || {},
            },
            quoteTokenId: evmData.quoteTokenId,
            manifest: evmData.manifest,
          });

          // Transition through state machine: pending -> deploying -> deployed
          await strategyService.markDeploying(strategy.id);
          await strategyService.markDeployed(strategy.id, {
            chainId: 31337, // Local SEMSEE chain
            contractAddress: evmData.contractAddress,
          });

          // Create AutomationWallet record linked to strategy
          // walletHash format: "evm/{walletAddress}" - uses the actual signing wallet address
          // Lookup by contract address should use: Strategy.contractAddress → strategyId → AutomationWallet
          const walletHash = `evm/${evmData.automationWallet.walletAddress.toLowerCase()}`;

          await prisma.automationWallet.create({
            data: {
              walletType: 'evm',
              userId: evmData.userId,
              strategyId: strategy.id,
              label: `${evmData.name} Automation Wallet`,
              walletHash,
              config: {
                strategyAddress: evmData.contractAddress,
                walletAddress: evmData.automationWallet.walletAddress,
                kmsKeyId: evmData.automationWallet.kmsKeyId,
                keyProvider: evmData.automationWallet.keyProvider,
                // Store encrypted key for LocalDevSigner persistence across restarts
                encryptedPrivateKey: evmData.automationWallet.encryptedPrivateKey,
              },
              isActive: true,
            },
          });

          strategyId = strategy.id;

          // Update cache to mark strategy as created (prevents duplicate creation)
          const cache = CacheService.getInstance();
          await cache.set(
            `deployment:${deploymentId}`,
            {
              ...evmData,
              strategyCreated: true,
              strategyId: strategy.id,
            },
            DEPLOYMENT_TTL_SECONDS
          );

          apiLogger.info(
            {
              requestId,
              deploymentId,
              strategyId: strategy.id,
              contractAddress: evmData.contractAddress,
              automationWalletAddress: evmData.automationWallet.walletAddress,
            },
            'Strategy and automation wallet created successfully after deployment'
          );

          // Log deployment completion to strategy logs
          try {
            await prisma.strategyLog.create({
              data: {
                strategyId: strategy.id,
                contractAddress: evmData.contractAddress,
                epoch: 0n,
                correlationId: requestId,
                level: 1, // INFO
                topic: '0x' + Buffer.from('DEPLOYMENT_COMPLETE').toString('hex').padEnd(64, '0'),
                topicName: 'DEPLOYMENT_COMPLETE',
                data: '0x',
                dataDecoded: `Strategy "${evmData.name}" deployed to ${evmData.contractAddress}`,
                timestamp: new Date(),
              },
            });
          } catch (logError) {
            // Non-fatal - don't fail deployment if log creation fails
            apiLogger.warn(
              { requestId, strategyId: strategy.id, error: logError },
              'Failed to create deployment log entry'
            );
          }
        } catch (createError) {
          apiLogger.error(
            {
              requestId,
              deploymentId,
              error: createError instanceof Error ? createError.message : String(createError),
            },
            'Failed to create Strategy after deployment'
          );
          // Don't fail the request - still return deployment status
          // Strategy creation can be retried on next poll
        }
      }

      // Always return 200 OK - status is in the body (REST standard)
      const response = createSuccessResponse({
        deploymentId: evmData.deploymentId,
        strategyId,
        status: evmData.status,
        contractAddress: evmData.contractAddress,
        txHash: evmData.txHash,
        startedAt: evmData.startedAt,
        completedAt: evmData.completedAt,
        error: evmData.error,
        // Include automation wallet address for frontend to detect wallet creation
        automationWallet: evmData.automationWallet
          ? { address: evmData.automationWallet.walletAddress }
          : null,
        // Include strategy object for frontend to detect strategy creation
        strategy: strategyId ? { id: strategyId } : null,
      });

      apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - startTime);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'GET /api/v1/strategies/deploy/[deploymentId]',
        error,
        { requestId }
      );

      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to get deployment status',
        error instanceof Error ? error.message : String(error)
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, {
        status: ErrorCodeToHttpStatus[ApiErrorCode.INTERNAL_SERVER_ERROR],
      });
    }
  });
}
