import type { Address, Hex } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';

/**
 * Well-known addresses for the SEMSEE embedded EVM
 */

/**
 * Core's private key - loaded from environment variable
 *
 * This key is used by the orchestrator to sign transactions.
 * The corresponding address must match the CORE address in CoreControlled.sol.
 *
 * Default: Foundry's default account 0 (funded via fund-core.sh at Docker startup)
 */
export const CORE_PRIVATE_KEY: Hex = (process.env.CORE_PRIVATE_KEY as Hex) ??
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/**
 * Core address - derived from the private key
 *
 * This is the identity used when Core makes calls into the EVM.
 * Funded with 1000 ETH at Docker startup via fund-core.sh.
 */
export const CORE_ADDRESS: Address = privateKeyToAddress(CORE_PRIVATE_KEY);

/**
 * SystemRegistry address - deployed by DeployStores script
 *
 * Set via environment variable after running the deployment script.
 * The deployment script outputs the address - copy it to SYSTEM_REGISTRY_ADDRESS env var.
 *
 * Note: With deterministic deployment (same deployer + nonce), the address is predictable.
 * First deployment from CORE account (nonce 0) = 0x5FbDB2315678afecb367f032d93F642f64180aa3
 */
export const SYSTEM_REGISTRY_ADDRESS: Address = (process.env.SYSTEM_REGISTRY_ADDRESS as Address) ??
  '0x5FbDB2315678afecb367f032d93F642f64180aa3';

/**
 * Gas limits for different operations
 */
export const GAS_LIMITS = {
  // Standard callback execution (onOhlcCandle, onPoolStateUpdate, etc.)
  CALLBACK: 500_000n,

  // Constructor execution when deploying strategies
  CONSTRUCTOR: 3_000_000n,

  // User-initiated actions
  USER_ACTION: 500_000n,

  // Store update operations
  STORE_UPDATE: 100_000n,
} as const;

/**
 * Subscription type identifiers (keccak256 hashes)
 * These match the values in the Solidity libraries
 */
export const SUBSCRIPTION_TYPES = {
  // keccak256("Subscription:Ohlc:v1")
  OHLC: '0x4f686c63537562736372697074696f6e3a763100000000000000000000000000' as Hex,

  // keccak256("Subscription:Pool:v1")
  POOL: '0x506f6f6c537562736372697074696f6e3a763100000000000000000000000000' as Hex,

  // keccak256("Subscription:Position:v1")
  POSITION: '0x506f736974696f6e537562736372697074696f6e3a7631000000000000000000' as Hex,

  // keccak256("Subscription:Balance:v1")
  BALANCE: '0x42616c616e6365537562736372697074696f6e3a763100000000000000000000' as Hex,
} as const;

/**
 * Action type identifiers (keccak256 hashes)
 * These match the values in the Solidity libraries
 */
export const ACTION_TYPES = {
  // keccak256("Action:UniswapV3:AddLiquidity:v1")
  ADD_LIQUIDITY: '0x556e697377617056333a4164644c69717569646974793a763100000000000000' as Hex,

  // keccak256("Action:UniswapV3:RemoveLiquidity:v1")
  REMOVE_LIQUIDITY: '0x556e697377617056333a52656d6f76654c69717569646974793a763100000000' as Hex,

  // keccak256("Action:UniswapV3:CollectFees:v1")
  COLLECT_FEES: '0x556e697377617056333a436f6c6c656374466565733a7631000000000000000' as Hex,

  // keccak256("Action:Funding:Withdraw:v1")
  WITHDRAW: '0x46756e64696e673a57697468647261773a76310000000000000000000000000' as Hex,
} as const;

/**
 * OHLC timeframes in minutes
 */
export const TIMEFRAMES = {
  ONE_MINUTE: 1,
  FIVE_MINUTES: 5,
  FIFTEEN_MINUTES: 15,
  ONE_HOUR: 60,
  FOUR_HOURS: 240,
  ONE_DAY: 1440,
} as const;
