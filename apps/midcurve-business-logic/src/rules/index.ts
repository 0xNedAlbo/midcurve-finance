/**
 * Business Rules Module
 *
 * Exports the BusinessRule base class, registry, and all rule implementations.
 *
 * ## Adding a New Rule
 *
 * 1. Create a new file in the rules directory with a descriptive kebab-case name
 *    Example: `fetch-ledger-events-when-position-created.ts`
 *
 * 2. Implement the rule by extending BusinessRule:
 *    ```typescript
 *    export class FetchLedgerEventsRule extends BusinessRule {
 *      readonly ruleName = 'fetch-ledger-events-when-position-created';
 *      readonly ruleDescription = 'Fetches historical ledger events when a new position is created';
 *
 *      protected async onStartup(): Promise<void> {
 *        // Set up event consumers
 *      }
 *
 *      protected async onShutdown(): Promise<void> {
 *        // Clean up resources
 *      }
 *    }
 *    ```
 *
 * 3. Export the rule from this file:
 *    ```typescript
 *    export { FetchLedgerEventsRule } from './fetch-ledger-events-when-position-created';
 *    ```
 *
 * 4. Register the rule in RuleManager.registerRules()
 */

// Base class and types
export { BusinessRule } from './base';
export type { BusinessRuleMetadata, BusinessRuleStatus } from './base';

// Registry
export { RuleRegistry } from './registry';

// =============================================================================
// Rule Implementations
// =============================================================================

// Platform-wide rules (not protocol-specific)
export { EnrichCoingeckoTokensRule } from './enrich-coingecko-tokens';
export { RefreshCoingeckoTokensRule } from './refresh-coingecko-tokens';

// User lifecycle rules
export { CreateAutomationWalletOnUserRegisteredRule } from './create-automation-wallet-on-user-registered';

// UniswapV3 protocol-specific rules
export * from './uniswapv3';

// Accounting rules (double-entry journal system)
export { PostJournalEntriesOnPositionEventsRule } from './accounting/post-journal-entries-on-position-events';
export { DailyNavSnapshotRule } from './accounting/daily-nav-snapshot';
