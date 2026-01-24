/**
 * Service layer types
 * Database-specific types and conversion utilities (not shared with UI)
 */

// User input types
export type { CreateUserInput, UpdateUserInput } from './user/index.js';

// Token input types
export type {
  CreateTokenInput,
  UpdateTokenInput,
  CreateErc20TokenInput,
  CreateAnyTokenInput,
  UpdateErc20TokenInput,
  UpdateAnyTokenInput,
  TokenDiscoverInputMap,
  TokenDiscoverInput,
  Erc20TokenDiscoverInput,
  AnyTokenDiscoverInput,
} from './token/index.js';

// Pool input types
export type {
  UniswapV3PoolDiscoverInput,
  PoolDiscoverInputMap,
  PoolDiscoverInput,
  AnyPoolDiscoverInput,
  CreatePoolInput,
  CreateUniswapV3PoolInput,
  CreateAnyPoolInput,
  UpdatePoolInput,
  UpdateUniswapV3PoolInput,
  UpdateAnyPoolInput,
} from './pool/index.js';

// Pool price input types
export type {
  UniswapV3PoolPriceDiscoverInput,
  PoolPriceDiscoverInputMap,
  PoolPriceDiscoverInput,
  AnyPoolPriceDiscoverInput,
  CreatePoolPriceInput,
  UpdatePoolPriceInput,
  CreateUniswapV3PoolPriceInput,
  UpdateUniswapV3PoolPriceInput,
  CreateAnyPoolPriceInput,
  UpdateAnyPoolPriceInput,
} from './pool-price/index.js';

// Uniswap V3 service types
export type {
  UniswapV3PoolStateDB,
  UniswapV3LedgerEventConfigDB,
  UniswapV3IncreaseLiquidityEventDB,
  UniswapV3DecreaseLiquidityEventDB,
  UniswapV3CollectEventDB,
  UniswapV3LedgerEventStateDB,
} from './uniswapv3/index.js';
export {
  toPoolState,
  toPoolStateDB,
  toEventConfig,
  toEventConfigDB,
  toEventState,
  toEventStateDB,
} from './uniswapv3/index.js';

// Position input types
export type {
  CreatePositionInput,
  UpdatePositionInput,
  UniswapV3PositionDiscoverInput,
  PositionDiscoverInput,
} from './position/index.js';

// Position List input types
export type { PositionListFilters, PositionListResult } from './position-list/index.js';

// Position Ledger Event input types
export type {
  CreatePositionLedgerEventInput,
  CreateUniswapV3LedgerEventInput,
  CreateAnyLedgerEventInput,
  UniswapV3LedgerEventDiscoverInput,
  PositionLedgerEventDiscoverInputMap,
  PositionLedgerEventDiscoverInput,
  UniswapV3EventDiscoverInput,
  AnyLedgerEventDiscoverInput,
} from './position-ledger/index.js';

// Quote Token input types
export type {
  QuoteTokenInput,
  QuoteTokenInputMap,
  UniswapV3QuoteTokenInput,
} from './quote-token/index.js';

// Pool Discovery input types
export type {
  PoolDiscoveryInputMap,
  PoolDiscoveryInput,
  UniswapV3PoolDiscoveryInput,
} from './pool-discovery/index.js';

// Automation input types
export type {
  RegisterCloseOrderInput,
  UpdateCloseOrderInput,
  FindCloseOrderOptions,
  MarkOrderRegisteredInput,
  MarkOrderTriggeredInput,
  MarkOrderExecutedInput,
  UpdatePoolSubscriptionInput,
  FindPoolSubscriptionOptions,
  AutomationPlatform,
  BaseLogContext,
  EvmLogContext,
  SolanaLogContext,
  OrderCreatedContext,
  OrderTriggeredContext,
  OrderExecutingContext,
  OrderExecutedContext,
  OrderFailedContext,
  OrderCancelledContext,
  PreflightValidationContext,
  SimulationFailedContext,
  AutomationLogContext,
  CreateAutomationLogInput,
  ListAutomationLogsOptions,
} from './automation/index.js';

// Notification input types
export type {
  CreateNotificationInput,
  ListNotificationsOptions,
  UpdateWebhookConfigInput,
  UpdateRangeStatusInput,
  PositionRangeTrackingInfo,
  RangeStatusChangeResult,
} from './notifications/index.js';
