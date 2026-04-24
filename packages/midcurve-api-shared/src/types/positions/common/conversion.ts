/**
 * Position Conversion Summary Types
 *
 * Response type for the /conversion endpoints:
 * - GET /api/v1/positions/uniswapv3/:chainId/:nftId/conversion
 * - GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/conversion
 *
 * The body is the serialized (bigint → string) form of ConversionSummary from
 * @midcurve/shared — reused here so the API, UI, and MCP server share one
 * contract without duplicating the field list.
 */

import type { SerializedConversionSummary } from '@midcurve/shared';
import type { ApiResponse } from '../../common/api-response.js';

export interface ConversionSummaryResponse extends ApiResponse<SerializedConversionSummary> {
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}
