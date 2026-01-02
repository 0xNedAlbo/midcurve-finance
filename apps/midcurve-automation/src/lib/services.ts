/**
 * Service Getters for Automation
 *
 * Provides lazy-initialized singleton instances of services.
 * Follows the same pattern as midcurve-api.
 */

import {
  AutomationContractService,
  CloseOrderService,
  PoolSubscriptionService,
  UniswapV3PoolService,
} from '@midcurve/services';

// Service instances (lazy-initialized)
let _automationContractService: AutomationContractService | null = null;
let _closeOrderService: CloseOrderService | null = null;
let _poolSubscriptionService: PoolSubscriptionService | null = null;
let _uniswapV3PoolService: UniswapV3PoolService | null = null;

/**
 * Get singleton instance of AutomationContractService
 */
export function getAutomationContractService(): AutomationContractService {
  if (!_automationContractService) {
    _automationContractService = new AutomationContractService();
  }
  return _automationContractService;
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
 * Get singleton instance of UniswapV3PoolService
 */
export function getUniswapV3PoolService(): UniswapV3PoolService {
  if (!_uniswapV3PoolService) {
    _uniswapV3PoolService = new UniswapV3PoolService();
  }
  return _uniswapV3PoolService;
}
