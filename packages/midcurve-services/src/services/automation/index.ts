/**
 * Automation Services Index
 *
 * Re-exports all automation service classes and types.
 * These services handle position automation features:
 * - Automation contracts (per-user, per-chain)
 * - Close orders (price-triggered position closing)
 * - Pool subscriptions (price monitoring)
 */

// Main services
export { AutomationContractService } from './automation-contract-service.js';
export type { AutomationContractServiceDependencies } from './automation-contract-service.js';

export { CloseOrderService } from './close-order-service.js';
export type { CloseOrderServiceDependencies } from './close-order-service.js';

export { PoolSubscriptionService } from './pool-subscription-service.js';
export type { PoolSubscriptionServiceDependencies } from './pool-subscription-service.js';
