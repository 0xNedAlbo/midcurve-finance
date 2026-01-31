/**
 * Zoom settings configuration for persistent storage.
 */

export const ZOOM_STORAGE_KEYS = {
  interactive: 'midcurve:zoom:interactive',
  summary: 'midcurve:zoom:summary',
} as const;

export const ZOOM_DEFAULTS: { interactive: number; summary: number } = {
  interactive: 1.0,
  summary: 1.0,
};

export const ZOOM_LIMITS = {
  min: 0.75,
  max: 1.25,
  step: 0.125,
} as const;
