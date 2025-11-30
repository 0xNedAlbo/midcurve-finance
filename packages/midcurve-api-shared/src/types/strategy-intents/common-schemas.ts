/**
 * Common Zod Schemas for Strategy Intents
 *
 * Reusable validation schemas for EVM-related fields.
 */

import { z } from 'zod';

/**
 * EVM address schema (0x + 40 hex characters)
 */
export const EvmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address');

/**
 * Chain ID schema (positive integer)
 */
export const ChainIdSchema = z.number().int().positive();

/**
 * Function selector schema (0x + 8 hex characters = 4 bytes)
 */
export const FunctionSelectorSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{8}$/, 'Invalid function selector (must be 4 bytes)');

/**
 * Hex string schema (0x + any hex characters)
 */
export const HexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]+$/, 'Invalid hex string');
