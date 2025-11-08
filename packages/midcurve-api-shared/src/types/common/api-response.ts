/**
 * Common API Response Types
 *
 * Standard response format for all API endpoints.
 * This file will be part of @midcurve/api-types in the future.
 */

import { z } from 'zod';

/**
 * Standard success response wrapper
 */
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    requestId?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
}

/**
 * Standard error response
 */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId?: string;
    timestamp?: string;
  };
}

/**
 * Union type for any API response
 */
export type ApiResult<T> = ApiResponse<T> | ApiError;

/**
 * Error codes enum for consistent error handling
 */
export enum ApiErrorCode {
  // Client errors (4xx)
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',

  // Server errors (5xx)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  BAD_GATEWAY = 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  // Business logic errors
  TOKEN_NOT_FOUND = 'TOKEN_NOT_FOUND',
  POOL_NOT_FOUND = 'POOL_NOT_FOUND',
  POSITION_NOT_FOUND = 'POSITION_NOT_FOUND',
  CHAIN_NOT_SUPPORTED = 'CHAIN_NOT_SUPPORTED',
  INVALID_ADDRESS = 'INVALID_ADDRESS',

  // Authentication errors
  WALLET_ALREADY_REGISTERED = 'WALLET_ALREADY_REGISTERED',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  NONCE_INVALID = 'NONCE_INVALID',
  NONCE_EXPIRED = 'NONCE_EXPIRED',
  API_KEY_NOT_FOUND = 'API_KEY_NOT_FOUND',
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  INVALID_SIWE_MESSAGE = 'INVALID_SIWE_MESSAGE',
}

/**
 * Zod schema for API error
 */
export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.nativeEnum(ApiErrorCode),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  meta: z
    .object({
      requestId: z.string().optional(),
      timestamp: z.string().optional(),
    })
    .catchall(z.unknown())
    .optional(),
});

/**
 * Helper to create a success response
 */
export function createSuccessResponse<T>(
  data: T,
  meta?: ApiResponse<T>['meta']
): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

/**
 * Helper to create an error response
 */
export function createErrorResponse(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  meta?: ApiError['meta']
): ApiError {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

/**
 * HTTP status code mapping for error codes
 */
export const ErrorCodeToHttpStatus: Record<ApiErrorCode, number> = {
  [ApiErrorCode.BAD_REQUEST]: 400,
  [ApiErrorCode.UNAUTHORIZED]: 401,
  [ApiErrorCode.FORBIDDEN]: 403,
  [ApiErrorCode.NOT_FOUND]: 404,
  [ApiErrorCode.CONFLICT]: 409,
  [ApiErrorCode.UNPROCESSABLE_ENTITY]: 422,
  [ApiErrorCode.TOO_MANY_REQUESTS]: 429,
  [ApiErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ApiErrorCode.BAD_GATEWAY]: 502,
  [ApiErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ApiErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [ApiErrorCode.VALIDATION_ERROR]: 400,
  [ApiErrorCode.TOKEN_NOT_FOUND]: 404,
  [ApiErrorCode.POOL_NOT_FOUND]: 404,
  [ApiErrorCode.POSITION_NOT_FOUND]: 404,
  [ApiErrorCode.CHAIN_NOT_SUPPORTED]: 400,
  [ApiErrorCode.INVALID_ADDRESS]: 400,
  [ApiErrorCode.WALLET_ALREADY_REGISTERED]: 409,
  [ApiErrorCode.INVALID_SIGNATURE]: 401,
  [ApiErrorCode.NONCE_INVALID]: 401,
  [ApiErrorCode.NONCE_EXPIRED]: 401,
  [ApiErrorCode.API_KEY_NOT_FOUND]: 404,
  [ApiErrorCode.WALLET_NOT_FOUND]: 404,
  [ApiErrorCode.INVALID_SIWE_MESSAGE]: 400,
};
