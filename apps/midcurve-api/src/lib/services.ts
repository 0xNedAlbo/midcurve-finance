/**
 * Service Singletons with Lazy Initialization
 *
 * This module provides singleton instances of services with lazy initialization
 * to prevent Prisma client access during Next.js build-time analysis.
 *
 * All services are instantiated only when first accessed, not at module load time.
 */

import {
  ApiKeyService,
  AuthUserService,
  AuthNonceService,
  SessionService,
  UserAllowListService,
  Erc20TokenService,
  CoingeckoTokenService,
  UserTokenBalanceService,
  Erc20ApprovalService,
  Erc721ApprovalService,
  UniswapV3PoolService,
  UniswapV3PoolSearchService,
  UniswapV3PositionService,
  PositionListService,
  UniswapV3CloseOrderService,
  SharedContractService,
  AutomationLogService,
  WebhookConfigService,
  FavoritePoolService,
  UniswapV3SubgraphClient,
  EvmTransactionStatusService,
  UniswapV3LedgerService,
  UniswapV3AprService,
  SwapRouterService,
  JournalService,
  UniswapV3VaultPositionService,
  UniswapV3VaultLedgerService,
  UniswapV3StakingPositionService,
  UniswapV3StakingLedgerService,
  UniswapV3StakingAprService,
  UserWalletService,
  PoolSigmaFilterService,
  UserSettingsService,
} from '@midcurve/services';

// Service instances (lazy-initialized)
let _authUserService: AuthUserService | null = null;
let _authNonceService: AuthNonceService | null = null;
let _sessionService: SessionService | null = null;
let _apiKeyService: ApiKeyService | null = null;
let _userAllowListService: UserAllowListService | null = null;
let _erc20TokenService: Erc20TokenService | null = null;
let _coingeckoTokenService: CoingeckoTokenService | null = null;
let _userTokenBalanceService: UserTokenBalanceService | null = null;
let _erc20ApprovalService: Erc20ApprovalService | null = null;
let _erc721ApprovalService: Erc721ApprovalService | null = null;
let _evmTransactionStatusService: EvmTransactionStatusService | null = null;
let _uniswapV3PoolService: UniswapV3PoolService | null = null;
let _uniswapV3PoolSearchService: UniswapV3PoolSearchService | null = null;
let _uniswapV3PositionService: UniswapV3PositionService | null = null;
let _positionListService: PositionListService | null = null;
let _uniswapV3CloseOrderService: UniswapV3CloseOrderService | null = null;
let _sharedContractService: SharedContractService | null = null;
let _automationLogService: AutomationLogService | null = null;
let _webhookConfigService: WebhookConfigService | null = null;
let _favoritePoolService: FavoritePoolService | null = null;
let _swapRouterService: SwapRouterService | null = null;
let _uniswapV3VaultPositionService: UniswapV3VaultPositionService | null = null;
let _uniswapV3StakingPositionService: UniswapV3StakingPositionService | null = null;
let _userWalletService: UserWalletService | null = null;
let _userSettingsService: UserSettingsService | null = null;

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
 * Get singleton instance of ApiKeyService
 */
export function getApiKeyService(): ApiKeyService {
  if (!_apiKeyService) {
    _apiKeyService = new ApiKeyService();
  }
  return _apiKeyService;
}

/**
 * Get singleton instance of UserAllowListService
 */
export function getUserAllowListService(): UserAllowListService {
  if (!_userAllowListService) {
    _userAllowListService = new UserAllowListService();
  }
  return _userAllowListService;
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
 * Get singleton instance of UniswapV3CloseOrderService
 */
export function getUniswapV3CloseOrderService(): UniswapV3CloseOrderService {
  if (!_uniswapV3CloseOrderService) {
    _uniswapV3CloseOrderService = new UniswapV3CloseOrderService();
  }
  return _uniswapV3CloseOrderService;
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
 * Get singleton instance of UserSettingsService
 */
export function getUserSettingsService(): UserSettingsService {
  if (!_userSettingsService) {
    _userSettingsService = new UserSettingsService();
  }
  return _userSettingsService;
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
 * Create a UniswapV3VaultLedgerService instance for a specific position.
 * Not a singleton — each position requires its own scoped instance.
 */
export function getUniswapV3VaultLedgerService(positionId: string): UniswapV3VaultLedgerService {
  return new UniswapV3VaultLedgerService({ positionId });
}

/**
 * Get singleton instance of UniswapV3VaultPositionService
 */
export function getUniswapV3VaultPositionService(): UniswapV3VaultPositionService {
  if (!_uniswapV3VaultPositionService) {
    _uniswapV3VaultPositionService = new UniswapV3VaultPositionService();
  }
  return _uniswapV3VaultPositionService;
}

// =============================================================================
// UniswapV3 Staking Vault factories (SPEC-0003b PR4b)
// =============================================================================

/** Get singleton instance of `UniswapV3StakingPositionService`. */
export function getUniswapV3StakingPositionService(): UniswapV3StakingPositionService {
  if (!_uniswapV3StakingPositionService) {
    _uniswapV3StakingPositionService = new UniswapV3StakingPositionService();
  }
  return _uniswapV3StakingPositionService;
}

/**
 * Create a `UniswapV3StakingLedgerService` for a specific position.
 * Not a singleton — each position requires its own scoped instance.
 */
export function getUniswapV3StakingPositionLedgerService(
  positionId: string,
): UniswapV3StakingLedgerService {
  return new UniswapV3StakingLedgerService({ positionId });
}

/**
 * Create a `UniswapV3StakingAprService` for a specific position.
 * Not a singleton — each position requires its own scoped instance.
 */
export function getUniswapV3StakingAprService(
  positionId: string,
): UniswapV3StakingAprService {
  return new UniswapV3StakingAprService({ positionId });
}

/**
 * Get singleton instance of UserWalletService
 */
export function getUserWalletService(): UserWalletService {
  if (!_userWalletService) {
    _userWalletService = new UserWalletService();
  }
  return _userWalletService;
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

/**
 * Get singleton instance of JournalService
 */
export function getJournalService(): JournalService {
  return JournalService.getInstance();
}

/**
 * Get singleton instance of PoolSigmaFilterService.
 *
 * Used to enrich pool API responses with σ-filter verdict, fee-APR, and
 * volatility blocks. See PRD-pool-sigma-filter.md.
 */
export function getPoolSigmaFilterService(): PoolSigmaFilterService {
  return PoolSigmaFilterService.getInstance();
}

