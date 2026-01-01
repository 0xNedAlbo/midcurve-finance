/**
 * Automation Contract Types
 *
 * Type definitions for automation contracts.
 * Automation contracts are deployed smart contracts that can
 * execute automated operations on positions (e.g., closing).
 */

/**
 * Automation contract type discriminator
 *
 * Extensible for future protocols:
 * - 'uniswapv3': UniswapV3PositionCloser contract
 * - 'orca': Orca position closer contract (future)
 * - 'raydium': Raydium position closer contract (future)
 */
export type AutomationContractType = 'uniswapv3';

/**
 * JSON-serializable representation of an automation contract
 *
 * Used for API responses and database storage.
 */
export interface AutomationContractJSON {
  id: string;
  contractType: AutomationContractType;
  userId: string;
  isActive: boolean;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Base parameters for creating any automation contract
 */
export interface BaseAutomationContractParams {
  id: string;
  userId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
