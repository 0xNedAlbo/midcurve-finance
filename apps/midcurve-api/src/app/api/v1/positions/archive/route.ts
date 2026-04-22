/**
 * Position Archive Endpoint
 *
 * PATCH /api/v1/positions/archive
 *
 * Archives or unarchives a position. Archived positions are hidden from the
 * active positions list but remain tracked in accounting.
 *
 * Authentication: Required (session only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/with-auth';
import { createPreflightResponse } from '@/lib/cors';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  ErrorCodeToHttpStatus,
} from '@midcurve/api-shared';
import { apiLogger } from '@/lib/logger';
import { PositionArchiveService } from '@midcurve/services';
import { z } from 'zod';

const ArchiveRequestSchema = z.object({
  positionId: z.string().min(1),
  archive: z.boolean(),
});

const archiveService = new PositionArchiveService();

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return withAuth(request, async (user) => {
    const log = apiLogger.child({ endpoint: 'positions/archive', userId: user.id });

    const body = await request.json();
    const parseResult = ArchiveRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          { errors: parseResult.error.flatten().fieldErrors },
        ),
        { status: ErrorCodeToHttpStatus[ApiErrorCode.VALIDATION_ERROR] },
      );
    }

    const { positionId, archive } = parseResult.data;

    await archiveService.setArchived(positionId, user.id, archive);

    log.info({ positionId, archive }, 'Position archive state updated');

    return NextResponse.json(
      createSuccessResponse({ positionId, isArchived: archive }),
    );
  });
}
