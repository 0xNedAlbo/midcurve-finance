/**
 * PositionActionsMenu - Three-dot dropdown menu for position actions
 *
 * Protocol-agnostic component that provides a dropdown menu with
 * actions for a position (currently only delete, expandable for future actions).
 *
 * Features:
 * - Three-dot menu button
 * - Click-outside detection with backdrop
 * - Delete action with destructive styling
 * - Disabled state during actions
 */

"use client";

import { useState } from "react";
import { MoreVertical, Trash2 } from "lucide-react";

interface PositionActionsMenuProps {
  onDelete: () => void;
  isDeleting?: boolean;
}

export function PositionActionsMenu({
  onDelete,
  isDeleting = false,
}: PositionActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Close menu when clicking outside
  const handleBackdropClick = () => {
    setIsOpen(false);
  };

  // Handle delete action
  const handleDelete = () => {
    setIsOpen(false);
    onDelete();
  };

  return (
    <div className="relative">
      {/* Three-dot menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isDeleting}
        className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        title="More actions"
      >
        <MoreVertical className="w-4 h-4 text-slate-400" />
      </button>

      {/* Backdrop for mobile/outside click detection */}
      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={handleBackdropClick} />
      )}

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 top-10 z-50 min-w-[160px] bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-lg shadow-xl shadow-black/20">
          <div className="py-1">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-slate-700/50 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              Delete Position
            </button>
            {/* Future: Add more actions here (Edit, Clone, Export, etc.) */}
          </div>
        </div>
      )}
    </div>
  );
}
