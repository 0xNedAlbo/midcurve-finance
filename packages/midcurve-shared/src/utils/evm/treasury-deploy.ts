/**
 * MidcurveTreasury deployment helpers
 *
 * The gas readiness gate deploys MidcurveTreasury from the connected user's
 * wallet: a plain contract-creation transaction with no `to` and the init code
 * as calldata. This module builds that init code.
 *
 * The deployed address is not predictable — it falls out of the deployer's
 * address and nonce, and is learned from the transaction receipt. That is
 * deliberate: recovering an orphaned treasury is an admin action (`sweep()` and
 * `rescueEth()` are `onlyAdmin`, and the admin address comes from environment
 * configuration rather than from the deploying user), so a duplicate or
 * stranded deployment costs nothing that cannot be retrieved.
 *
 * Once the address is in `shared_contracts`, that row is the single source of
 * truth. Nothing here derives or guesses an address for an already-registered
 * treasury.
 */

import { encodeAbiParameters, concatHex, type Address, type Hex } from 'viem';
import { MIDCURVE_TREASURY_CREATION_BYTECODE } from '../../abis/midcurve-treasury/bytecode.js';
import { normalizeAddress } from './address.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Constructor arguments for MidcurveTreasury.
 *
 * All four are zero-checked by the constructor, so a missing value reverts the
 * deployment rather than producing a broken treasury.
 */
export interface TreasuryConstructorArgs {
  /** Environment's configured admin address — NOT the deploying user */
  admin: string;
  /** Environment's operator EOA, the address refuelOperator() pays out to */
  operator: string;
  /** MidcurveSwapRouter on this chain, from the shared contract registry */
  swapRouter: string;
  /** Wrapped native currency on this chain, from the chain registry */
  weth: string;
}

// ============================================================================
// Init code
// ============================================================================

const CONSTRUCTOR_ABI_PARAMS = [
  { name: 'admin_', type: 'address' },
  { name: 'operator_', type: 'address' },
  { name: 'swapRouter_', type: 'address' },
  { name: 'weth_', type: 'address' },
] as const;

/**
 * Build deployable init code: creation bytecode followed by the ABI-encoded
 * constructor arguments.
 *
 * Addresses are normalized to EIP-55 first, so a caller passing a lowercase
 * address from a database row and one passing a checksummed address from the
 * chain registry produce identical calldata.
 *
 * @throws if any argument is not a valid EVM address
 */
export function buildTreasuryInitCode(args: TreasuryConstructorArgs): Hex {
  const encodedArgs = encodeAbiParameters(CONSTRUCTOR_ABI_PARAMS, [
    normalizeAddress(args.admin) as Address,
    normalizeAddress(args.operator) as Address,
    normalizeAddress(args.swapRouter) as Address,
    normalizeAddress(args.weth) as Address,
  ]);

  return concatHex([MIDCURVE_TREASURY_CREATION_BYTECODE, encodedArgs]);
}
