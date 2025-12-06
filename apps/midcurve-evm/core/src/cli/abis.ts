/**
 * ABI definitions for CLI commands
 */

/**
 * IStrategy interface ABI - for lifecycle management
 */
export const STRATEGY_ABI = [
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'state',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'start',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'shutdown',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'StrategyStarted',
    inputs: [],
  },
  {
    type: 'event',
    name: 'StrategyShutdown',
    inputs: [],
  },
] as const;

/**
 * IOhlcConsumer interface ABI - for sending OHLC events
 */
export const OHLC_CONSUMER_ABI = [
  {
    type: 'function',
    name: 'onOhlcCandle',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'timeframe', type: 'uint8' },
      {
        name: 'candle',
        type: 'tuple',
        components: [
          { name: 'timestamp', type: 'uint256' },
          { name: 'open', type: 'uint256' },
          { name: 'high', type: 'uint256' },
          { name: 'low', type: 'uint256' },
          { name: 'close', type: 'uint256' },
          { name: 'volume', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * OhlcLoggerStrategy-specific ABI - for reading candle count
 */
export const OHLC_LOGGER_ABI = [
  ...STRATEGY_ABI,
  {
    type: 'function',
    name: 'candleCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ETH_USD_MARKET',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const;

/**
 * LogMessage event ABI - for watching strategy logs
 */
export const LOG_MESSAGE_ABI = [
  {
    type: 'event',
    name: 'LogMessage',
    inputs: [
      { name: 'level', type: 'uint8', indexed: true },
      { name: 'message', type: 'string', indexed: false },
      { name: 'data', type: 'bytes', indexed: false },
    ],
  },
] as const;

/**
 * Strategy state enum values
 */
export const STRATEGY_STATES = ['Created', 'Running', 'Shutdown'] as const;

/**
 * Log level enum values (array)
 */
export const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

/**
 * Log level name to numeric value mapping
 */
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;
