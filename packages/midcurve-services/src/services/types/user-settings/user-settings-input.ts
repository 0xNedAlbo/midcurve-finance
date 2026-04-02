/**
 * Input types for UserSettingsService
 *
 * These types define the parameters accepted by UserSettingsService methods.
 */

import type { UserSettingsData } from '@midcurve/shared';

/**
 * Input for upserting full user settings
 */
export type UpdateUserSettingsInput = Partial<UserSettingsData>;
