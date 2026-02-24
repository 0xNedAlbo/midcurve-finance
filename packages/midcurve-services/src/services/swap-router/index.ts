export { SwapRouterService } from './swap-router-service.js';
export type { SwapRouterServiceDependencies } from './swap-router-service.js';

export { ParaswapSwapService, PARASWAP_VENUE_ID } from './paraswap-swap-service.js';
export type {
  ParaswapSwapServiceDependencies,
  ParaswapSwapInput,
  ParaswapSwapResult,
  ParaswapSwapExecute,
  ParaswapSwapDoNotExecute,
} from './paraswap-swap-service.js';

export type {
  PostCloseSwapInput,
  PostCloseSwapResult,
  FreeformSwapInput,
  FreeformSwapResult,
  SwapInstruction,
  DoNotExecute,
  SwapHop,
  SwapDiagnostics,
  PositionDataInput,
  DiscoveredPool,
  CandidatePath,
  PathHop,
} from './types.js';

export {
  SwapTokenReadError,
  PositionReadError,
  PoolDiscoveryError,
  FairValuePriceError,
} from './errors.js';

export { MIDCURVE_SWAP_ROUTER_ABI } from './abi.js';
