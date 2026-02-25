/**
 * Position Ledger Service Exports
 */

export {
  UniswapV3LedgerService,
  type UniswapV3LedgerServiceConfig,
  type UniswapV3LedgerServiceDependencies,
  type CreateLedgerEventInput,
  // Event signatures and validation
  UNISWAP_V3_POSITION_EVENT_SIGNATURES,
  validateRawEvent,
  decodeLogData,
  type ValidEventType,
  type RawLogInput,
  type ValidateRawEventResult,
  type DecodedLogData,
  // Import result types
  type LedgerAggregates,
  type SingleLogResult,
  type ImportLogsResult,
} from './uniswapv3-ledger-service.js';

// Re-export APR types for backward compatibility
export type { AprPeriodData } from '../types/position-apr/index.js';
