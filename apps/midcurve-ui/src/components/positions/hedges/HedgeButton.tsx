/**
 * HedgeButton - Toggle button for hedge section
 *
 * States:
 * - No hedges: Green "+ Hedge" button (to create new hedge)
 * - Has hedges (collapsed): Cyan "Hedges (n) ▼" with ChevronDown
 * - Has hedges (expanded): Cyan "Hedges (n) ▲" with ChevronUp
 */

'use client';

import { Plus, ChevronUp, ChevronDown } from 'lucide-react';

interface HedgeButtonProps {
  /**
   * Whether the hedge section is expanded
   */
  isExpanded: boolean;

  /**
   * Callback when button is clicked
   */
  onToggle: () => void;

  /**
   * Number of hedges (for display)
   */
  hedgeCount: number;
}

export function HedgeButton({ isExpanded, onToggle, hedgeCount }: HedgeButtonProps) {
  // No hedges: Green "+ Hedge" button
  if (hedgeCount === 0) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
      >
        <Plus className="w-3 h-3" />
        Hedge
      </button>
    );
  }

  // Has hedges: Cyan toggle button with chevron
  const ChevronIcon = isExpanded ? ChevronUp : ChevronDown;

  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-cyan-300 bg-cyan-900/20 hover:bg-cyan-800/30 border-cyan-600/50"
    >
      Hedges ({hedgeCount})
      <ChevronIcon className="w-3 h-3" />
    </button>
  );
}
