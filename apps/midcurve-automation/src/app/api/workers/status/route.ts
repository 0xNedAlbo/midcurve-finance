/**
 * Worker Status Endpoint
 *
 * Returns detailed statistics for all automation workers.
 */

import { NextResponse } from 'next/server';
import { getWorkerManager, type WorkerManagerStatus } from '../../../../workers';

export interface WorkerStatusResponse {
  success: true;
  data: WorkerManagerStatus;
}

export async function GET(): Promise<NextResponse<WorkerStatusResponse>> {
  const workerManager = getWorkerManager();
  const status = workerManager.getStatus();

  return NextResponse.json({
    success: true,
    data: status,
  });
}
