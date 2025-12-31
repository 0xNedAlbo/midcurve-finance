/**
 * Log Level Badge
 *
 * Displays a color-coded badge for log levels.
 * - DEBUG (0): Gray
 * - INFO (1): Blue
 * - WARN (2): Amber/Yellow
 * - ERROR (3): Red
 */

import type { LogLevel, LogLevelName } from "@midcurve/api-shared";

interface LogLevelBadgeProps {
  /**
   * Numeric log level (0-3)
   */
  level: LogLevel;
  /**
   * Optional human-readable level name (if not provided, derived from level)
   */
  levelName?: LogLevelName;
}

/**
 * Level configuration for styling
 */
const LEVEL_CONFIG: Record<
  LogLevel,
  {
    name: LogLevelName;
    textColor: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  0: {
    name: "DEBUG",
    textColor: "text-slate-300",
    bgColor: "bg-slate-700/40",
    borderColor: "border-slate-600/50",
  },
  1: {
    name: "INFO",
    textColor: "text-blue-300",
    bgColor: "bg-blue-900/30",
    borderColor: "border-blue-700/50",
  },
  2: {
    name: "WARN",
    textColor: "text-amber-300",
    bgColor: "bg-amber-900/30",
    borderColor: "border-amber-700/50",
  },
  3: {
    name: "ERROR",
    textColor: "text-red-300",
    bgColor: "bg-red-900/30",
    borderColor: "border-red-700/50",
  },
};

export function LogLevelBadge({ level, levelName }: LogLevelBadgeProps) {
  const config = LEVEL_CONFIG[level] ?? LEVEL_CONFIG[1];
  const displayName = levelName ?? config.name;

  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border
        ${config.textColor} ${config.bgColor} ${config.borderColor}
      `}
    >
      {displayName}
    </span>
  );
}

/**
 * Get the color class for a log level (for text coloring)
 */
export function getLogLevelColor(level: LogLevel): string {
  return LEVEL_CONFIG[level]?.textColor ?? LEVEL_CONFIG[1].textColor;
}

/**
 * Get the log level name from numeric value
 */
export function getLogLevelName(level: LogLevel): LogLevelName {
  return LEVEL_CONFIG[level]?.name ?? "INFO";
}
