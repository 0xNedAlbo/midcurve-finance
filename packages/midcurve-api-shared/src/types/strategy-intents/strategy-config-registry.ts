/**
 * Strategy Config Registry
 *
 * Dynamic validation of strategy-specific configurations based on strategyType.
 * New strategy types can be added by registering their schemas here.
 */

import { z } from 'zod';
import { BasicUniswapV3StrategyConfigSchema } from './configs/index.js';

/**
 * Registry mapping strategy types to their Zod schemas
 */
export const StrategyConfigSchemaRegistry: Record<string, z.ZodSchema> = {
  basicUniswapV3: BasicUniswapV3StrategyConfigSchema,
};

/**
 * Get the Zod schema for a given strategy type
 *
 * @param strategyType - The strategy type identifier
 * @returns The Zod schema for the strategy config, or undefined if not found
 */
export function getStrategyConfigSchema(
  strategyType: string
): z.ZodSchema | undefined {
  return StrategyConfigSchemaRegistry[strategyType];
}

/**
 * Validate strategy configuration using the registry
 *
 * @param strategyType - The strategy type identifier
 * @param config - The configuration to validate
 * @returns Zod SafeParseReturnType with validation result
 */
export function validateStrategyConfig(
  strategyType: string,
  config: unknown
): z.SafeParseReturnType<unknown, unknown> {
  const schema = getStrategyConfigSchema(strategyType);

  if (!schema) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: `Unknown strategy type: ${strategyType}`,
          path: ['strategyType'],
        },
      ]),
    };
  }

  return schema.safeParse(config);
}

/**
 * Check if a strategy type is registered
 *
 * @param strategyType - The strategy type identifier
 * @returns true if the strategy type is known
 */
export function isKnownStrategyType(strategyType: string): boolean {
  return strategyType in StrategyConfigSchemaRegistry;
}

/**
 * Get all registered strategy types
 *
 * @returns Array of registered strategy type identifiers
 */
export function getRegisteredStrategyTypes(): string[] {
  return Object.keys(StrategyConfigSchemaRegistry);
}
