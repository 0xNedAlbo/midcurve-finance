/**
 * Event Type Utilities
 *
 * Provides mappings and utilities for displaying position ledger event types
 * with appropriate icons, colors, and labels.
 */

/**
 * Position ledger event types
 */
export type EventType =
  | 'INCREASE_POSITION'
  | 'DECREASE_POSITION'
  | 'COLLECT'
  | 'MINT'
  | 'BURN'
  | 'TRANSFER'
  | 'VAULT_MINT'
  | 'VAULT_BURN'
  | 'VAULT_COLLECT_YIELD'
  | 'VAULT_TRANSFER_IN'
  | 'VAULT_TRANSFER_OUT';

/**
 * Visual metadata for an event type
 */
export interface EventTypeInfo {
  label: string;        // Human-readable label
  icon: string;         // Emoji icon
  color: string;        // Tailwind text color class
  bgColor: string;      // Tailwind background color class
}

/**
 * Mapping of event types to their visual representation
 */
const EVENT_TYPE_MAP: Record<EventType, EventTypeInfo> = {
  INCREASE_POSITION: {
    label: 'Liquidity Added',
    icon: '📈',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
  },
  DECREASE_POSITION: {
    label: 'Liquidity Removed',
    icon: '📉',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
  },
  COLLECT: {
    label: 'Collect',
    icon: '💰',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
  },
  MINT: {
    label: 'Position Minted',
    icon: '🪙',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
  },
  BURN: {
    label: 'Position Burned',
    icon: '🔥',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
  },
  TRANSFER: {
    label: 'Position Transferred',
    icon: '🔄',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
  },
  VAULT_MINT: {
    label: 'Shares Minted',
    icon: '🪙',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
  },
  VAULT_BURN: {
    label: 'Shares Burned',
    icon: '🔥',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
  },
  VAULT_COLLECT_YIELD: {
    label: 'Yield Collected',
    icon: '💰',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
  },
  VAULT_TRANSFER_IN: {
    label: 'Shares Received',
    icon: '📥',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
  },
  VAULT_TRANSFER_OUT: {
    label: 'Shares Sent',
    icon: '📤',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
  },
};

/**
 * Get the visual metadata for a given event type
 *
 * @param eventType - The event type
 * @returns The visual metadata (label, icon, colors)
 */
export function getEventTypeInfo(eventType: EventType): EventTypeInfo {
  return EVENT_TYPE_MAP[eventType] || {
    label: eventType,
    icon: '❓',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/20',
  };
}

/**
 * Check if an event type is a liquidity increase
 *
 * @param eventType - The event type to check
 * @returns True if this is an INCREASE_POSITION event
 */
export function isIncreaseEvent(eventType: EventType): boolean {
  return eventType === 'INCREASE_POSITION';
}

/**
 * Check if an event type is a liquidity decrease
 *
 * @param eventType - The event type to check
 * @returns True if this is a DECREASE_POSITION event
 */
export function isDecreaseEvent(eventType: EventType): boolean {
  return eventType === 'DECREASE_POSITION';
}

/**
 * Check if an event type is a fee collection
 *
 * @param eventType - The event type to check
 * @returns True if this is a COLLECT event
 */
export function isCollectEvent(eventType: EventType): boolean {
  return eventType === 'COLLECT' || eventType === 'VAULT_COLLECT_YIELD';
}

