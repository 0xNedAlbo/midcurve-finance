/**
 * Position Ledger Service Exports
 */

export {
  UniswapV3LedgerEventService,
  type UniswapV3LedgerEventServiceConfig,
  type UniswapV3LedgerEventServiceDependencies,
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
} from './uniswapv3-ledger-event-service.js';

// Re-export APR types for backward compatibility
export type { AprPeriodData } from '../types/position-apr/index.js';
