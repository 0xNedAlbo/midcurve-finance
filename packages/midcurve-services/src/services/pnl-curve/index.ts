/**
 * PnL Curve Service
 *
 * Service for generating PnL curves for concentrated liquidity positions
 * with support for automated close orders (stop-loss, take-profit).
 */

export { PnLCurveService } from './pnl-curve-service.js';
export type { PnLCurveServiceDependencies } from './pnl-curve-service.js';

export type {
  OrderType,
  OrderStatus,
  PnLCurveOrder,
  PnLCurvePoint,
  PnLCurveTokenInfo,
  PnLCurveData,
  GeneratePnLCurveInput,
  PositionDataForCurve,
} from './types.js';
