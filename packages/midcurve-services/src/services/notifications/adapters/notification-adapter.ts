/**
 * Notification Adapter Interface
 *
 * Defines the contract for notification delivery adapters.
 * Each adapter handles its own enrichment, formatting, preferences,
 * and delivery. All adapters MUST be best-effort: errors are caught
 * and logged internally, never thrown to the caller.
 */

import type { NotificationEvent } from '../events/index.js';

/**
 * Interface for notification delivery adapters.
 *
 * Implementations must:
 * - Never throw errors (catch and log internally)
 * - Handle their own enrichment (fetch position/pool data if needed)
 * - Manage their own per-user preferences (event filtering, config)
 */
export interface NotificationAdapter {
  /** Human-readable adapter name for logging */
  readonly name: string;

  /**
   * Deliver a notification event.
   * Implementations MUST NOT throw — all errors caught internally.
   */
  deliver(event: NotificationEvent): Promise<void>;
}
