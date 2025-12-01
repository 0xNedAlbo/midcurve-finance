/**
 * Event Providers
 *
 * Sources of strategy events:
 * - ActionPoller: User actions from database
 * - (Future) OhlcProvider: Market data from Hyperliquid
 * - (Future) PositionProvider: On-chain position events
 * - (Future) FundingProvider: Deposit/withdraw events
 */

export { ActionPoller } from './action-poller.js';
