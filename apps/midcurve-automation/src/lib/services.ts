/**
 * Service Getters for Automation
 *
 * Provides lazy-initialized singleton instances of services.
 * Follows the same pattern as midcurve-api.
 */

import {
  CloseOrderService,
  CloseOrderExecutionService,
  AutomationSubscriptionService,
  UniswapV3PoolService,
  AutomationLogService,
  UniswapV3PositionService,
  WebhookConfigService,
  UserNotificationService,
  UiNotificationAdapter,
  WebhookNotificationAdapter,
} from '@midcurve/services';

// Service instances (lazy-initialized)
let _closeOrderService: CloseOrderService | null = null;
let _closeOrderExecutionService: CloseOrderExecutionService | null = null;
let _automationSubscriptionService: AutomationSubscriptionService | null = null;
let _uniswapV3PoolService: UniswapV3PoolService | null = null;
let _automationLogService: AutomationLogService | null = null;
let _positionService: UniswapV3PositionService | null = null;
let _webhookConfigService: WebhookConfigService | null = null;
let _userNotificationService: UserNotificationService | null = null;

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
 * Get singleton instance of CloseOrderExecutionService
 */
export function getCloseOrderExecutionService(): CloseOrderExecutionService {
  if (!_closeOrderExecutionService) {
    _closeOrderExecutionService = new CloseOrderExecutionService();
  }
  return _closeOrderExecutionService;
}

/**
 * Get singleton instance of AutomationSubscriptionService
 */
export function getAutomationSubscriptionService(): AutomationSubscriptionService {
  if (!_automationSubscriptionService) {
    _automationSubscriptionService = new AutomationSubscriptionService();
  }
  return _automationSubscriptionService;
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
 * Get singleton instance of WebhookConfigService
 */
export function getWebhookConfigService(): WebhookConfigService {
  if (!_webhookConfigService) {
    _webhookConfigService = new WebhookConfigService();
  }
  return _webhookConfigService;
}

/**
 * Get singleton instance of UserNotificationService (with adapters wired)
 */
export function getUserNotificationService(): UserNotificationService {
  if (!_userNotificationService) {
    _userNotificationService = new UserNotificationService({
      adapters: [
        new UiNotificationAdapter({
          positionService: getPositionService(),
        }),
        new WebhookNotificationAdapter({
          webhookConfigService: getWebhookConfigService(),
          positionService: getPositionService(),
          closeOrderService: getCloseOrderService(),
        }),
      ],
    });
  }
  return _userNotificationService;
}
