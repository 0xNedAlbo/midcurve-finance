/**
 * Service Singletons with Lazy Initialization
 *
 * This module provides singleton instances of services with lazy initialization
 * to prevent Prisma client access during Next.js build-time analysis.
 *
 * All services are instantiated only when first accessed, not at module load time.
 */

import {
  AuthUserService,
  AuthNonceService,
  SessionService,
  Erc20TokenService,
  CoingeckoTokenService,
  UserTokenBalanceService,
  Erc20ApprovalService,
  Erc721ApprovalService,
  UniswapV3PoolService,
  UniswapV3PoolDiscoveryService,
  UniswapV3PoolSearchService,
  UniswapV3PositionService,
  PositionListService,
  OnChainCloseOrderService,
  SharedContractService,
  PoolSubscriptionService,
  AutomationLogService,
  WebhookConfigService,
  FavoritePoolService,
  UniswapV3SubgraphClient,
  EvmTransactionStatusService,
  UniswapV3LedgerService,
  UniswapV3AprService,
  SwapRouterService,
} from '@midcurve/services';

// Service instances (lazy-initialized)
let _authUserService: AuthUserService | null = null;
let _authNonceService: AuthNonceService | null = null;
let _sessionService: SessionService | null = null;
let _erc20TokenService: Erc20TokenService | null = null;
let _coingeckoTokenService: CoingeckoTokenService | null = null;
let _userTokenBalanceService: UserTokenBalanceService | null = null;
let _erc20ApprovalService: Erc20ApprovalService | null = null;
let _erc721ApprovalService: Erc721ApprovalService | null = null;
let _evmTransactionStatusService: EvmTransactionStatusService | null = null;
let _uniswapV3PoolService: UniswapV3PoolService | null = null;
let _uniswapV3PoolDiscoveryService: UniswapV3PoolDiscoveryService | null = null;
let _uniswapV3PoolSearchService: UniswapV3PoolSearchService | null = null;
let _uniswapV3PositionService: UniswapV3PositionService | null = null;
let _positionListService: PositionListService | null = null;
let _onChainCloseOrderService: OnChainCloseOrderService | null = null;
let _sharedContractService: SharedContractService | null = null;
let _poolSubscriptionService: PoolSubscriptionService | null = null;
let _automationLogService: AutomationLogService | null = null;
let _webhookConfigService: WebhookConfigService | null = null;
let _favoritePoolService: FavoritePoolService | null = null;
let _swapRouterService: SwapRouterService | null = null;

/**
 * Get singleton instance of AuthUserService
 */
export function getAuthUserService(): AuthUserService {
  if (!_authUserService) {
    _authUserService = new AuthUserService();
  }
  return _authUserService;
}

/**
 * Get singleton instance of AuthNonceService
 */
export function getAuthNonceService(): AuthNonceService {
  if (!_authNonceService) {
    _authNonceService = new AuthNonceService();
  }
  return _authNonceService;
}

/**
 * Get singleton instance of SessionService
 */
export function getSessionService(): SessionService {
  if (!_sessionService) {
    _sessionService = new SessionService();
  }
  return _sessionService;
}

/**
 * Get singleton instance of Erc20TokenService
 *
 * Injects CoingeckoTokenService for cache integration:
 * - discover() checks coingecko_tokens cache before CoinGecko API calls
 * - discover() writes enrichment data back to cache after successful API calls
 */
export function getErc20TokenService(): Erc20TokenService {
  if (!_erc20TokenService) {
    _erc20TokenService = new Erc20TokenService({
      coingeckoTokenService: getCoingeckoTokenService(),
    });
  }
  return _erc20TokenService;
}

/**
 * Get singleton instance of CoingeckoTokenService
 */
export function getCoingeckoTokenService(): CoingeckoTokenService {
  if (!_coingeckoTokenService) {
    _coingeckoTokenService = new CoingeckoTokenService();
  }
  return _coingeckoTokenService;
}

/**
 * Get singleton instance of UniswapV3PoolService
 */
export function getUniswapV3PoolService(): UniswapV3PoolService {
  if (!_uniswapV3PoolService) {
    _uniswapV3PoolService = new UniswapV3PoolService();
  }
  return _uniswapV3PoolService;
}

/**
 * Get singleton instance of UniswapV3PositionService
 */
export function getUniswapV3PositionService(): UniswapV3PositionService {
  if (!_uniswapV3PositionService) {
    _uniswapV3PositionService = new UniswapV3PositionService();
  }
  return _uniswapV3PositionService;
}

/**
 * Get singleton instance of UserTokenBalanceService
 */
export function getUserTokenBalanceService(): UserTokenBalanceService {
  if (!_userTokenBalanceService) {
    _userTokenBalanceService = new UserTokenBalanceService();
  }
  return _userTokenBalanceService;
}

/**
 * Get singleton instance of Erc20ApprovalService
 */
export function getErc20ApprovalService(): Erc20ApprovalService {
  if (!_erc20ApprovalService) {
    _erc20ApprovalService = new Erc20ApprovalService();
  }
  return _erc20ApprovalService;
}

/**
 * Get singleton instance of Erc721ApprovalService
 */
export function getErc721ApprovalService(): Erc721ApprovalService {
  if (!_erc721ApprovalService) {
    _erc721ApprovalService = new Erc721ApprovalService();
  }
  return _erc721ApprovalService;
}

/**
 * Get singleton instance of EvmTransactionStatusService
 */
export function getEvmTransactionStatusService(): EvmTransactionStatusService {
  if (!_evmTransactionStatusService) {
    _evmTransactionStatusService = new EvmTransactionStatusService();
  }
  return _evmTransactionStatusService;
}

/**
 * Get singleton instance of UniswapV3PoolDiscoveryService
 */
export function getUniswapV3PoolDiscoveryService(): UniswapV3PoolDiscoveryService {
  if (!_uniswapV3PoolDiscoveryService) {
    _uniswapV3PoolDiscoveryService = new UniswapV3PoolDiscoveryService();
  }
  return _uniswapV3PoolDiscoveryService;
}

/**
 * Get singleton instance of UniswapV3PoolSearchService
 */
export function getUniswapV3PoolSearchService(): UniswapV3PoolSearchService {
  if (!_uniswapV3PoolSearchService) {
    _uniswapV3PoolSearchService = new UniswapV3PoolSearchService();
  }
  return _uniswapV3PoolSearchService;
}

/**
 * Get singleton instance of PositionListService
 */
export function getPositionListService(): PositionListService {
  if (!_positionListService) {
    _positionListService = new PositionListService();
  }
  return _positionListService;
}

/**
 * Get singleton instance of OnChainCloseOrderService
 */
export function getOnChainCloseOrderService(): OnChainCloseOrderService {
  if (!_onChainCloseOrderService) {
    _onChainCloseOrderService = new OnChainCloseOrderService();
  }
  return _onChainCloseOrderService;
}

/**
 * Get singleton instance of SharedContractService
 */
export function getSharedContractService(): SharedContractService {
  if (!_sharedContractService) {
    _sharedContractService = new SharedContractService();
  }
  return _sharedContractService;
}

/**
 * Get singleton instance of PoolSubscriptionService
 */
export function getPoolSubscriptionService(): PoolSubscriptionService {
  if (!_poolSubscriptionService) {
    _poolSubscriptionService = new PoolSubscriptionService();
  }
  return _poolSubscriptionService;
}

/**
 * Get singleton instance of AutomationLogService
 */
export function getAutomationLogService(): AutomationLogService {
  if (!_automationLogService) {
    _automationLogService = new AutomationLogService();
  }
  return _automationLogService;
}

/**
 * Get singleton instance of WebhookConfigService
 */
export function getWebhookConfigService(): WebhookConfigService {
  if (!_webhookConfigService) {
    _webhookConfigService = new WebhookConfigService();
  }
  return _webhookConfigService;
}

/**
 * Get singleton instance of FavoritePoolService
 */
export function getFavoritePoolService(): FavoritePoolService {
  if (!_favoritePoolService) {
    _favoritePoolService = new FavoritePoolService();
  }
  return _favoritePoolService;
}

/**
 * Create a UniswapV3LedgerService instance for a specific position.
 * Not a singleton — each position requires its own scoped instance.
 */
export function getUniswapV3PositionLedgerService(positionId: string): UniswapV3LedgerService {
  return new UniswapV3LedgerService({ positionId });
}

/**
 * Create a UniswapV3AprService instance for a specific position.
 * Not a singleton — each position requires its own scoped instance.
 */
export function getUniswapV3AprService(positionId: string): UniswapV3AprService {
  return new UniswapV3AprService({ positionId });
}

/**
 * Get singleton instance of SwapRouterService
 */
export function getSwapRouterService(): SwapRouterService {
  if (!_swapRouterService) {
    _swapRouterService = new SwapRouterService();
  }
  return _swapRouterService;
}

/**
 * Get singleton instance of UniswapV3SubgraphClient
 */
export function getSubgraphClient(): UniswapV3SubgraphClient {
  return UniswapV3SubgraphClient.getInstance();
}
