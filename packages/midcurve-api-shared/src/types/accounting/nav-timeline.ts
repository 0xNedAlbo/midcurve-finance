/**
 * NAV Timeline API types
 */

export interface NavTimelinePoint {
  date: string;
  netAssetValue: string;
}

export type NavTimelineResponse = NavTimelinePoint[];
