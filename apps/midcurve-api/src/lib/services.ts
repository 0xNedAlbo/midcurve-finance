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
  UserTokenBalanceService,
  UniswapV3PoolService,
  UniswapV3PoolDiscoveryService,
  UniswapV3PositionService,
  UniswapV3PositionLedgerService,
  PositionListService,
  PositionAprService,
  CloseOrderService,
  PoolSubscriptionService,
  AutomationLogService,
  PnLCurveService,
  NotificationService,
  WebhookConfigService,
  WebhookDeliveryService,
} from '@midcurve/services';

// Service instances (lazy-initialized)
let _authUserService: AuthUserService | null = null;
let _authNonceService: AuthNonceService | null = null;
let _sessionService: SessionService | null = null;
let _erc20TokenService: Erc20TokenService | null = null;
let _userTokenBalanceService: UserTokenBalanceService | null = null;
let _uniswapV3PoolService: UniswapV3PoolService | null = null;
let _uniswapV3PoolDiscoveryService: UniswapV3PoolDiscoveryService | null = null;
let _uniswapV3PositionService: UniswapV3PositionService | null = null;
let _uniswapV3PositionLedgerService: UniswapV3PositionLedgerService | null = null;
let _positionListService: PositionListService | null = null;
let _positionAprService: PositionAprService | null = null;
let _closeOrderService: CloseOrderService | null = null;
let _poolSubscriptionService: PoolSubscriptionService | null = null;
let _automationLogService: AutomationLogService | null = null;
let _pnlCurveService: PnLCurveService | null = null;
let _notificationService: NotificationService | null = null;
let _webhookConfigService: WebhookConfigService | null = null;
let _webhookDeliveryService: WebhookDeliveryService | null = null;

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
 */
export function getErc20TokenService(): Erc20TokenService {
  if (!_erc20TokenService) {
    _erc20TokenService = new Erc20TokenService();
  }
  return _erc20TokenService;
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
 * Get singleton instance of PositionAprService
 */
export function getPositionAprService(): PositionAprService {
  if (!_positionAprService) {
    _positionAprService = new PositionAprService();
  }
  return _positionAprService;
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
 * Get singleton instance of UniswapV3PoolDiscoveryService
 */
export function getUniswapV3PoolDiscoveryService(): UniswapV3PoolDiscoveryService {
  if (!_uniswapV3PoolDiscoveryService) {
    _uniswapV3PoolDiscoveryService = new UniswapV3PoolDiscoveryService();
  }
  return _uniswapV3PoolDiscoveryService;
}

/**
 * Get singleton instance of UniswapV3PositionLedgerService
 */
export function getUniswapV3PositionLedgerService(): UniswapV3PositionLedgerService {
  if (!_uniswapV3PositionLedgerService) {
    _uniswapV3PositionLedgerService = new UniswapV3PositionLedgerService();
  }
  return _uniswapV3PositionLedgerService;
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
 * Get singleton instance of CloseOrderService
 */
export function getCloseOrderService(): CloseOrderService {
  if (!_closeOrderService) {
    _closeOrderService = new CloseOrderService();
  }
  return _closeOrderService;
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
 * Get singleton instance of PnLCurveService
 */
export function getPnLCurveService(): PnLCurveService {
  if (!_pnlCurveService) {
    _pnlCurveService = new PnLCurveService();
  }
  return _pnlCurveService;
}

/**
 * Get singleton instance of NotificationService
 */
export function getNotificationService(): NotificationService {
  if (!_notificationService) {
    _notificationService = new NotificationService();
  }
  return _notificationService;
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
 * Get singleton instance of WebhookDeliveryService
 */
export function getWebhookDeliveryService(): WebhookDeliveryService {
  if (!_webhookDeliveryService) {
    _webhookDeliveryService = new WebhookDeliveryService();
  }
  return _webhookDeliveryService;
}
