/**
 * WebSocket Event Metrics Tracker
 *
 * Counts incoming events per subscription type per chain to identify
 * which subscriptions drive Alchemy CU consumption.
 */

import { onchainDataLogger } from './logger';
import { CHAIN_NAMES, type SupportedChainId } from './config';

const log = onchainDataLogger.child({ component: 'WsMetrics' });

export type SubscriptionType =
  | 'pool-swap'
  | 'pool-price'
  | 'nfpm-liquidity'
  | 'closer-lifecycle'
  | 'nfpm-transfer'
  | 'erc20-approval';

interface ChainMetrics {
  eventCounts: Map<SubscriptionType, number>;
  reconnectCounts: Map<SubscriptionType, number>;
}

class WsMetricsTracker {
  private chains: Map<SupportedChainId, ChainMetrics> = new Map();
  private reportIntervalId: ReturnType<typeof setInterval> | null = null;
  private reportIntervalMs: number;

  constructor() {
    this.reportIntervalMs = parseInt(
      process.env.WS_METRICS_REPORT_INTERVAL_MS || '60000',
      10
    );
  }

  /**
   * Record events from a subscription batch's handleLogs.
   */
  recordEvents(chainId: SupportedChainId, type: SubscriptionType, count: number): void {
    const metrics = this.ensureChain(chainId);
    const current = metrics.eventCounts.get(type) ?? 0;
    metrics.eventCounts.set(type, current + count);
  }

  /**
   * Record a reconnection event from a subscription batch.
   */
  recordReconnect(chainId: SupportedChainId, type: SubscriptionType): void {
    const metrics = this.ensureChain(chainId);
    const current = metrics.reconnectCounts.get(type) ?? 0;
    metrics.reconnectCounts.set(type, current + 1);
  }

  private ensureChain(chainId: SupportedChainId): ChainMetrics {
    let metrics = this.chains.get(chainId);
    if (!metrics) {
      metrics = { eventCounts: new Map(), reconnectCounts: new Map() };
      this.chains.set(chainId, metrics);
    }
    return metrics;
  }

  start(): void {
    this.reportIntervalId = setInterval(() => {
      this.logReport();
    }, this.reportIntervalMs);

    log.info({
      reportIntervalMs: this.reportIntervalMs,
      msg: 'WsMetrics started',
    });
  }

  stop(): void {
    if (this.reportIntervalId) {
      clearInterval(this.reportIntervalId);
      this.reportIntervalId = null;
    }
    this.logReport();
    this.chains.clear();
    log.info({ msg: 'WsMetrics stopped' });
  }

  getSnapshot(): Record<string, { eventCounts: Record<string, number>; reconnectCounts: Record<string, number> }> {
    const result: Record<string, { eventCounts: Record<string, number>; reconnectCounts: Record<string, number> }> = {};
    for (const [chainId, metrics] of this.chains) {
      const name = CHAIN_NAMES[chainId] ?? String(chainId);
      result[name] = {
        eventCounts: Object.fromEntries(metrics.eventCounts),
        reconnectCounts: Object.fromEntries(metrics.reconnectCounts),
      };
    }
    return result;
  }

  private logReport(): void {
    let totalEvents = 0;

    let totalReconnects = 0;

    for (const [chainId, metrics] of this.chains) {
      const chainName = CHAIN_NAMES[chainId] ?? String(chainId);
      const eventCountsObj = Object.fromEntries(metrics.eventCounts);
      const reconnectCountsObj = Object.fromEntries(metrics.reconnectCounts);
      const chainTotal = Array.from(metrics.eventCounts.values()).reduce((a, b) => a + b, 0);
      const chainReconnects = Array.from(metrics.reconnectCounts.values()).reduce((a, b) => a + b, 0);
      totalEvents += chainTotal;
      totalReconnects += chainReconnects;

      log.info({
        chainId,
        chainName,
        totalEvents: chainTotal,
        eventCounts: eventCountsObj,
        reconnects: chainReconnects,
        reconnectCounts: reconnectCountsObj,
        msg: `WS metrics: ${chainName} - ${chainTotal} events, ${chainReconnects} reconnects`,
      });

      metrics.eventCounts.clear();
      metrics.reconnectCounts.clear();
    }

    const projectedDailyEvents = Math.round(
      (totalEvents / this.reportIntervalMs) * 86_400_000
    );

    log.info({
      totalEvents,
      totalReconnects,
      reportIntervalMs: this.reportIntervalMs,
      projectedDailyEvents,
      msg: `WS metrics total: ${totalEvents} events, ${totalReconnects} reconnects | projected daily: ~${projectedDailyEvents}`,
    });
  }
}

export const wsMetrics = new WsMetricsTracker();
