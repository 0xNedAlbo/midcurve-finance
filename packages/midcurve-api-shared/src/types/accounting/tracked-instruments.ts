/**
 * Tracked Instruments API types
 *
 * Toggle accounting tracking for a position.
 */

import { z } from 'zod';

export const ToggleTrackingRequestSchema = z.object({
  positionHash: z.string().min(1, 'positionHash must not be empty'),
});

export type ToggleTrackingRequest = z.infer<typeof ToggleTrackingRequestSchema>;

export interface ToggleTrackingResponse {
  tracked: boolean;
}
