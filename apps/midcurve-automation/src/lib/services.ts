/**
 * Service Getters for Automation
 *
 * Provides lazy-initialized singleton instances of services.
 * Follows the same pattern as midcurve-api.
 */

import {
  OnChainCloseOrderService,
  CloseOrderExecutionService,
  PoolSubscriptionService,
  UniswapV3PoolService,
  AutomationLogService,
  UniswapV3PositionService,
  PositionRangeTrackerService,
  NotificationService,
  WebhookDeliveryService,
  HedgeVaultService,
} from '@midcurve/services';

// Service instances (lazy-initialized)
let _onChainCloseOrderService: OnChainCloseOrderService | null = null;
let _closeOrderExecutionService: CloseOrderExecutionService | null = null;
let _poolSubscriptionService: PoolSubscriptionService | null = null;
let _uniswapV3PoolService: UniswapV3PoolService | null = null;
let _automationLogService: AutomationLogService | null = null;
let _positionService: UniswapV3PositionService | null = null;
let _positionRangeTrackerService: PositionRangeTrackerService | null = null;
let _notificationService: NotificationService | null = null;
let _webhookDeliveryService: WebhookDeliveryService | null = null;
let _hedgeVaultService: HedgeVaultService | null = null;

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
 * Get singleton instance of CloseOrderExecutionService
 */
export function getCloseOrderExecutionService(): CloseOrderExecutionService {
  if (!_closeOrderExecutionService) {
    _closeOrderExecutionService = new CloseOrderExecutionService();
  }
  return _closeOrderExecutionService;
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
 * Get singleton instance of UniswapV3PoolService
 */
export function getUniswapV3PoolService(): UniswapV3PoolService {
  if (!_uniswapV3PoolService) {
    _uniswapV3PoolService = new UniswapV3PoolService();
  }
  return _uniswapV3PoolService;
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
 * Get singleton instance of UniswapV3PositionService
 */
export function getPositionService(): UniswapV3PositionService {
  if (!_positionService) {
    _positionService = new UniswapV3PositionService();
  }
  return _positionService;
}

/**
 * Get singleton instance of PositionRangeTrackerService
 */
export function getPositionRangeTrackerService(): PositionRangeTrackerService {
  if (!_positionRangeTrackerService) {
    _positionRangeTrackerService = new PositionRangeTrackerService();
  }
  return _positionRangeTrackerService;
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
 * Get singleton instance of WebhookDeliveryService
 */
export function getWebhookDeliveryService(): WebhookDeliveryService {
  if (!_webhookDeliveryService) {
    _webhookDeliveryService = new WebhookDeliveryService();
  }
  return _webhookDeliveryService;
}

/**
 * Get singleton instance of HedgeVaultService
 */
export function getHedgeVaultService(): HedgeVaultService {
  if (!_hedgeVaultService) {
    _hedgeVaultService = new HedgeVaultService();
  }
  return _hedgeVaultService;
}
