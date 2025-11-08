/**
 * Common Serialization Type Helpers
 *
 * Utility types for converting domain types to JSON-serializable formats.
 */

/**
 * Type helper for serialized values
 * Represents a value that has been recursively serialized (bigint → string, Date → string)
 */
export type SerializedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SerializedValue[]
  | { [key: string]: SerializedValue };

/**
 * Recursively convert bigint fields to strings for JSON serialization
 *
 * This type transformer recursively walks through an object type and converts:
 * - bigint → string
 * - Date → string (ISO 8601)
 * - Arrays → recursively transformed arrays
 * - Objects → recursively transformed objects
 *
 * Use this when you need to define API response types that mirror domain types
 * but with bigints converted to strings for JSON compatibility.
 *
 * @template T - The input type (typically from @midcurve/shared)
 *
 * @example
 * import type { UniswapV3Position } from '@midcurve/shared';
 * import type { BigIntToString } from '@/types/common';
 *
 * // Automatically converts all bigint fields to string
 * export type PositionApiResponse = BigIntToString<UniswapV3Position>;
 */
export type BigIntToString<T> = T extends bigint
  ? string
  : T extends Date
  ? string // ISO 8601
  : T extends Array<infer U>
  ? Array<BigIntToString<U>>
  : T extends object
  ? { [K in keyof T]: BigIntToString<T[K]> }
  : T;
