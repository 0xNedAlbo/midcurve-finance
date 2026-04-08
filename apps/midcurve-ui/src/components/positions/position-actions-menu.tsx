/**
 * PositionActionsMenu - Three-dot dropdown menu for position actions
 *
 * Protocol-agnostic component that provides a dropdown menu with
 * actions for a position.
 *
 * Features:
 * - Three-dot menu button
 * - Click-outside detection with backdrop
 * - Reload history action
 * - Delete action with destructive styling
 * - Disabled state during actions
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, Trash2, RotateCcw, ArrowRightLeft } from "lucide-react";

interface PositionActionsMenuProps {
  onReloadHistory: () => void;
  onSwitchQuoteToken: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
  isReloadingHistory?: boolean;
  isSwitchingQuoteToken?: boolean;
}

export function PositionActionsMenu({
  onReloadHistory,
  onSwitchQuoteToken,
  onDelete,
  isDeleting = false,
  isReloadingHistory = false,
  isSwitchingQuoteToken = false,
}: PositionActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Calculate menu position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4, // 4px gap below button
        right: window.innerWidth - rect.right, // Distance from right edge
      });
    }
  }, [isOpen]);

  // Disable menu if any action is in progress
  const isActionInProgress = isDeleting || isReloadingHistory || isSwitchingQuoteToken;

  // Close menu when clicking outside
  const handleBackdropClick = () => {
    setIsOpen(false);
  };

  // Handle reload history action
  const handleReloadHistory = () => {
    setIsOpen(false);
    onReloadHistory();
  };

  // Handle switch quote token action
  const handleSwitchQuoteToken = () => {
    setIsOpen(false);
    onSwitchQuoteToken();
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
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        disabled={isActionInProgress}
        className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        title="More actions"
      >
        <MoreVertical className="w-4 h-4 text-slate-400" />
      </button>

      {/* Portal-rendered dropdown (above all other content) */}
      {isOpen && mounted && createPortal(
        <>
          {/* Backdrop for mobile/outside click detection */}
          <div className="fixed inset-0 z-40" onClick={handleBackdropClick} />

          {/* Dropdown menu */}
          <div
            className="fixed z-50 min-w-[180px] bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-lg shadow-xl shadow-black/20"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
            }}
          >
            <div className="py-1">
              <button
                onClick={handleReloadHistory}
                disabled={isActionInProgress}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" />
                Reload History
              </button>
              <button
                onClick={handleSwitchQuoteToken}
                disabled={isActionInProgress}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Switch Quote Token
              </button>
              <button
                onClick={handleDelete}
                disabled={isActionInProgress}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-slate-700/50 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                Delete Position
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
