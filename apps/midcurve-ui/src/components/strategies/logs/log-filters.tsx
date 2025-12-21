/**
 * Log Filters
 *
 * Filter controls for strategy logs:
 * - Log level dropdown (All, DEBUG, INFO, WARN, ERROR)
 */

import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { LogLevel } from "@midcurve/api-shared";

interface LogFiltersProps {
  /**
   * Current selected log level (undefined = all levels)
   */
  selectedLevel: LogLevel | undefined;

  /**
   * Callback when level selection changes
   */
  onLevelChange: (level: LogLevel | undefined) => void;
}

/**
 * Level options for the dropdown
 */
const LEVEL_OPTIONS: Array<{ value: LogLevel | undefined; label: string }> = [
  { value: undefined, label: "All Levels" },
  { value: 0, label: "DEBUG" },
  { value: 1, label: "INFO" },
  { value: 2, label: "WARN" },
  { value: 3, label: "ERROR" },
];

export function LogFilters({ selectedLevel, onLevelChange }: LogFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get current selection label
  const currentLabel =
    LEVEL_OPTIONS.find((opt) => opt.value === selectedLevel)?.label ?? "All Levels";

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex items-center gap-3">
      {/* Level Filter Dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg text-slate-300 transition-colors cursor-pointer"
        >
          <span>{currentLabel}</span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-40 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 overflow-hidden">
            {LEVEL_OPTIONS.map((option) => (
              <button
                key={option.value ?? "all"}
                onClick={() => {
                  onLevelChange(option.value);
                  setIsOpen(false);
                }}
                className={`
                  w-full px-3 py-2 text-left text-sm transition-colors cursor-pointer
                  ${
                    selectedLevel === option.value
                      ? "bg-blue-600/20 text-blue-300"
                      : "text-slate-300 hover:bg-slate-700/50"
                  }
                `}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
