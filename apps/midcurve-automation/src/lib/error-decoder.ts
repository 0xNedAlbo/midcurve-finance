/**
 * Error Decoder Utility
 *
 * Decodes EVM revert data into human-readable error messages.
 * Supports UniswapV3PositionCloser custom errors and standard revert strings.
 */

import { decodeErrorResult, type Hex, type Abi } from 'viem';
import { UniswapV3PositionCloserV100Abi } from '@midcurve/shared';
import { automationLogger } from './logger';

const log = automationLogger.child({ component: 'ErrorDecoder' });

/**
 * Known error selectors for UniswapV3PositionCloser and common EVM errors.
 * Maps 4-byte selectors to human-readable descriptions.
 */
const ERROR_DESCRIPTIONS: Record<string, string> = {
  // UniswapV3PositionCloser errors
  '0x30cd7471': 'NotOwner: Caller is not the order owner',
  '0x7c214f04': 'NotOperator: Caller is not the designated operator',
  '0xd92e233d': 'ZeroAddress: Zero address provided where non-zero required',
  '0x49c26c64': 'SlippageBpsOutOfRange: Slippage exceeds maximum allowed (10000 bps)',
  '0xa8834357': 'InvalidBounds: Invalid price trigger bounds configuration',
  '0xe064752b': 'WrongStatus: Order is in wrong status for this operation',
  '0xa12436aa': 'CloseExpired: Close order has expired (validUntil passed)',
  '0xbbaee1a8': 'PriceConditionNotMet: Price trigger condition not satisfied',
  '0x9d6db1ad': 'NftNotOwnedByRecordedOwner: NFT ownership changed since registration',
  '0xa38f26fd': 'NftNotApproved: NFT not approved for the contract',
  '0x84c6b9b5': 'FeeBpsTooHigh: Operator fee exceeds cap (100 bps / 1%)',
  '0x90b8ec18': 'TransferFailed: ERC20 token transfer failed',
  '0x350c20f1': 'ExternalCallFailed: External contract call failed',
  '0xc7e13a01': 'TickOutOfRange: Tick value out of valid range',

  // Standard EVM errors
  '0x08c379a0': 'Error(string)', // Will be decoded further
  '0x4e487b71': 'Panic(uint256)', // Solidity panic codes

  // Common Uniswap V3 errors
  '0xa1bf7886': 'LOK: Pool is locked (reentrancy guard)',
  '0x2fe0284f': 'TLU: Tick lower must be less than upper',
  '0x9ad612e8': 'TLM: Tick lower too low',
  '0xd7b54ab1': 'TUM: Tick upper too high',
};

/**
 * Solidity panic codes
 * @see https://docs.soliditylang.org/en/latest/control-structures.html#panic-via-assert-and-error-via-require
 */
const PANIC_CODES: Record<string, string> = {
  '0x00': 'Generic compiler panic',
  '0x01': 'Assertion failed',
  '0x11': 'Arithmetic overflow/underflow',
  '0x12': 'Division by zero',
  '0x21': 'Invalid enum value',
  '0x22': 'Invalid storage access',
  '0x31': 'Pop on empty array',
  '0x32': 'Array index out of bounds',
  '0x41': 'Memory allocation overflow',
  '0x51': 'Uninitialized function pointer',
};

/**
 * Decode revert data into a human-readable error message.
 *
 * @param revertData - The raw revert data from the transaction
 * @returns Human-readable error description
 */
export function decodeRevertReason(revertData: Hex | string | unknown): string {
  // Handle empty or invalid data
  if (!revertData) {
    return 'Unknown error (no revert data)';
  }

  // Ensure revertData is a string - handle object cases
  let data: Hex;
  if (typeof revertData === 'string') {
    data = revertData as Hex;
  } else if (typeof revertData === 'object' && revertData !== null) {
    // Some RPC errors return data as an object with a data property
    const obj = revertData as Record<string, unknown>;
    if (typeof obj.data === 'string') {
      data = obj.data as Hex;
    } else {
      log.debug({ revertData, type: typeof revertData }, 'Unexpected revert data format');
      return `Unknown error (unexpected data format: ${typeof revertData})`;
    }
  } else {
    log.debug({ revertData, type: typeof revertData }, 'Unexpected revert data type');
    return `Unknown error (unexpected data type: ${typeof revertData})`;
  }

  if (data === '0x' || data.length < 10) {
    return 'Unknown error (no revert data)';
  }

  const selector = data.slice(0, 10).toLowerCase();

  // Check known error selectors
  const knownDescription = ERROR_DESCRIPTIONS[selector];

  // Handle standard Error(string) revert
  if (selector === '0x08c379a0') {
    try {
      const decoded = decodeErrorResult({
        abi: [
          {
            type: 'error',
            name: 'Error',
            inputs: [{ type: 'string', name: 'message' }],
          },
        ],
        data,
      });
      return `Revert: ${decoded.args[0]}`;
    } catch (e) {
      log.debug({ selector, error: e }, 'Failed to decode Error(string)');
      return 'Revert (failed to decode message)';
    }
  }

  // Handle Solidity panic
  if (selector === '0x4e487b71') {
    try {
      const decoded = decodeErrorResult({
        abi: [
          {
            type: 'error',
            name: 'Panic',
            inputs: [{ type: 'uint256', name: 'code' }],
          },
        ],
        data,
      });
      const panicCode = '0x' + decoded.args[0].toString(16).padStart(2, '0');
      const panicDescription = PANIC_CODES[panicCode] || 'Unknown panic code';
      return `Panic(${panicCode}): ${panicDescription}`;
    } catch (e) {
      log.debug({ selector, error: e }, 'Failed to decode Panic');
      return 'Panic (failed to decode code)';
    }
  }

  // Try to decode using the PositionCloser ABI
  try {
    const decoded = decodeErrorResult({ abi: UniswapV3PositionCloserV100Abi as Abi, data });

    // Format the error with its arguments
    if (decoded.args && decoded.args.length > 0) {
      const argsStr = decoded.args
        .map((arg) => {
          if (typeof arg === 'bigint') {
            return arg.toString();
          }
          return String(arg);
        })
        .join(', ');
      return `${decoded.errorName}(${argsStr})`;
    }

    return decoded.errorName;
  } catch (e) {
    // ABI decoding failed, use known description if available
    log.debug({ selector, error: e }, 'Failed to decode with contract ABI');
  }

  // Return known description or unknown error
  if (knownDescription && knownDescription !== 'Error(string)' && knownDescription !== 'Panic(uint256)') {
    return knownDescription;
  }

  return `Unknown error (selector: ${selector}, data length: ${data.length} bytes)`;
}

/**
 * Format a decoded error for logging and user display.
 *
 * @param revertReason - The decoded revert reason
 * @param txHash - Optional transaction hash for reference
 * @returns Formatted error string
 */
export function formatRevertError(revertReason: string, txHash?: string): string {
  const txRef = txHash ? ` (tx: ${txHash})` : '';
  return `Transaction reverted: ${revertReason}${txRef}`;
}
