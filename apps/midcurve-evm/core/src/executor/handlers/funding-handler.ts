/**
 * Funding Effect Handlers
 *
 * Handlers for vault funding operations on public chains.
 * These execute when strategy contracts emit USE_FUNDS or RETURN_FUNDS effects.
 *
 * Architecture:
 * - Strategy contract runs on SEMSEE (31337)
 * - Vault contract runs on public chain (Ethereum, Arbitrum, etc.)
 * - Operator wallet bridges funds between chains
 *
 * Fund flow:
 * - USE_FUNDS: Vault → Operator (via vault.useFunds)
 * - RETURN_FUNDS: Operator → Vault (via vault.returnFunds)
 *
 * Gas Reimbursement:
 * - After each successful vault operation, the operator is reimbursed
 * - Gas is paid from the vault's ETH gas pool
 * - This is automatic and not exposed to the strategy contract
 */

import { type Hex, type Address, keccak256, toHex, decodeAbiParameters, encodeAbiParameters, createPublicClient, http } from 'viem';
import { logger } from '../../../../lib/logger.js';
import { getDatabaseClient } from '../../clients/database-client.js';
import { getSignerClient } from '../../clients/signer-client.js';
import type { EffectHandler, EffectHandlerResult } from './types.js';
import type { EffectRequestMessage } from '../../mq/messages.js';

// =============================================================================
// Effect Type Constants
// =============================================================================

/** Effect type: Request funds from vault to operator wallet */
export const EFFECT_USE_FUNDS = keccak256(toHex('USE_FUNDS')) as Hex;

/** Effect type: Return funds from operator wallet to vault */
export const EFFECT_RETURN_FUNDS = keccak256(toHex('RETURN_FUNDS')) as Hex;

// =============================================================================
// Shared Utilities
// =============================================================================

const log = logger.child({ handler: 'FundingHandler' });

/**
 * Get strategy ID from contract address via database lookup.
 * Throws if strategy not found.
 */
async function getStrategyIdFromAddress(strategyAddress: string): Promise<string> {
  const dbClient = getDatabaseClient();
  const strategy = await dbClient.getStrategyByAddress(strategyAddress as Address);

  if (!strategy) {
    throw new Error(`Strategy not found for address: ${strategyAddress}`);
  }

  return strategy.id;
}

/**
 * Decode USE_FUNDS or RETURN_FUNDS payload.
 * Format: abi.encode(uint256 amount)
 */
function decodeAmountPayload(payload: Hex): bigint {
  const [amount] = decodeAbiParameters(
    [{ type: 'uint256', name: 'amount' }],
    payload
  );
  return amount;
}

/**
 * Encode result data: abi.encode(uint256 actualAmount)
 */
function encodeAmountResult(actualAmount: bigint): Hex {
  return encodeAbiParameters(
    [{ type: 'uint256', name: 'actualAmount' }],
    [actualAmount]
  );
}

/** Map of chain IDs to RPC URL environment variable names */
const RPC_URL_ENV_MAP: Record<number, string> = {
  1: 'RPC_URL_ETHEREUM',
  42161: 'RPC_URL_ARBITRUM',
  8453: 'RPC_URL_BASE',
  56: 'RPC_URL_BSC',
  137: 'RPC_URL_POLYGON',
  10: 'RPC_URL_OPTIMISM',
};

/**
 * Create a public client for the vault's chain.
 */
function createVaultPublicClient(chainId: number) {
  const envVar = RPC_URL_ENV_MAP[chainId];
  if (!envVar) {
    throw new Error(`Unsupported vault chain ID: ${chainId}`);
  }

  const rpcUrl = process.env[envVar];
  if (!rpcUrl) {
    throw new Error(`RPC URL not configured for chain ${chainId} (${envVar})`);
  }

  return createPublicClient({
    transport: http(rpcUrl),
  });
}

/**
 * Reimburse operator for gas costs after a successful vault operation.
 *
 * This is called automatically after USE_FUNDS or RETURN_FUNDS transactions.
 * Gas is taken from the vault's ETH gas pool.
 *
 * @param strategyId - Strategy ID for signer API
 * @param chainId - Public chain ID where vault lives
 * @param gasUsed - Gas units used in the vault transaction
 * @param effectiveGasPrice - Gas price in wei
 */
async function reimburseOperatorGas(
  strategyId: string,
  chainId: number,
  gasUsed: bigint,
  effectiveGasPrice: bigint
): Promise<void> {
  const actualGasCost = gasUsed * effectiveGasPrice;

  log.info({
    strategyId,
    gasUsed: gasUsed.toString(),
    effectiveGasPrice: effectiveGasPrice.toString(),
    actualGasCost: actualGasCost.toString(),
    msg: 'Reimbursing operator gas',
  });

  try {
    const signerClient = getSignerClient();
    const signResult = await signerClient.signVaultReimburseGas({
      strategyId,
      amountWei: actualGasCost.toString(),
    });

    const publicClient = createVaultPublicClient(chainId);
    const txHash = await publicClient.sendRawTransaction({
      serializedTransaction: signResult.signedTransaction,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });

    if (receipt.status === 'reverted') {
      log.error({ strategyId, txHash, msg: 'Gas reimbursement transaction reverted' });
      // Don't fail the effect - main operation succeeded
      return;
    }

    log.info({
      strategyId,
      txHash,
      reimbursedWei: actualGasCost.toString(),
      msg: 'Gas reimbursement completed',
    });
  } catch (error) {
    // Log but don't fail - main operation succeeded
    log.error({
      strategyId,
      error: error instanceof Error ? error.message : 'Unknown error',
      msg: 'Failed to reimburse gas (non-fatal)',
    });
  }
}

// =============================================================================
// USE_FUNDS Handler
// =============================================================================

/**
 * Handler for USE_FUNDS effects.
 *
 * Transfers tokens from vault to operator wallet on public chain.
 * Called when strategy needs funds for operations (e.g., opening positions).
 *
 * Flow:
 * 1. Decode amount from payload
 * 2. Look up strategy → vault config
 * 3. Sign vault.useFunds(operator, amount) via signer service
 * 4. Broadcast transaction to public chain
 * 5. Wait for confirmation
 * 6. Return actual amount transferred
 */
export class UseFundsHandler implements EffectHandler {
  readonly effectType = EFFECT_USE_FUNDS;
  readonly name = 'USE_FUNDS';

  async handle(request: EffectRequestMessage): Promise<EffectHandlerResult> {
    const startTime = Date.now();

    try {
      // 1. Decode amount from payload
      const amount = decodeAmountPayload(request.payload as Hex);
      log.info({
        strategyAddress: request.strategyAddress,
        amount: amount.toString(),
        msg: 'Processing USE_FUNDS effect',
      });

      // 2. Look up strategy and vault config
      const strategyId = await getStrategyIdFromAddress(request.strategyAddress);
      const dbClient = getDatabaseClient();
      const vaultInfo = await dbClient.getStrategyVaultInfo(strategyId);

      if (!vaultInfo) {
        log.error({ strategyId, msg: 'Vault not configured for strategy' });
        return {
          ok: false,
          data: '0x' as Hex,
        };
      }

      // Currently only EVM vaults are supported
      const vaultConfig = vaultInfo.vaultConfig;
      if (vaultConfig.type !== 'evm') {
        log.error({ strategyId, vaultType: vaultConfig.type, msg: 'Non-EVM vault not supported' });
        return {
          ok: false,
          data: '0x' as Hex,
        };
      }

      // 3. Sign the transaction via signer service
      const signerClient = getSignerClient();
      const signResult = await signerClient.signVaultUseFunds({
        strategyId,
        amount: amount.toString(),
      });

      // 4. Broadcast to public chain
      const publicClient = createVaultPublicClient(vaultConfig.chainId);
      const txHash = await publicClient.sendRawTransaction({
        serializedTransaction: signResult.signedTransaction,
      });

      // 5. Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
      });

      if (receipt.status === 'reverted') {
        log.error({
          strategyId,
          txHash,
          msg: 'USE_FUNDS transaction reverted',
        });
        return {
          ok: false,
          data: '0x' as Hex,
        };
      }

      // 6. Reimburse operator for gas costs
      await reimburseOperatorGas(
        strategyId,
        vaultConfig.chainId,
        receipt.gasUsed,
        receipt.effectiveGasPrice
      );

      // 7. Return success with actual amount
      // Note: In a more sophisticated implementation, we'd parse FundsUsed event
      // to get the actual amount. For now, assume requested amount = actual amount.
      const actualAmount = amount;

      log.info({
        strategyId,
        txHash,
        amount: actualAmount.toString(),
        durationMs: Date.now() - startTime,
        msg: 'USE_FUNDS effect completed',
      });

      return {
        ok: true,
        data: encodeAmountResult(actualAmount),
      };
    } catch (error) {
      log.error({
        strategyAddress: request.strategyAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'USE_FUNDS effect failed',
      });

      return {
        ok: false,
        data: '0x' as Hex,
      };
    }
  }
}

// =============================================================================
// RETURN_FUNDS Handler
// =============================================================================

/**
 * Handler for RETURN_FUNDS effects.
 *
 * Returns tokens from operator wallet to vault on public chain.
 * Called when strategy wants to return unused funds or close positions.
 *
 * Flow:
 * 1. Decode amount from payload
 * 2. Look up strategy → vault config
 * 3. Sign vault.returnFunds(amount) via signer service
 * 4. Broadcast transaction to public chain
 * 5. Wait for confirmation
 * 6. Return actual amount returned
 *
 * Note: Operator must have approved vault to transfer tokens before this call.
 * The signer service should handle approval if needed.
 */
export class ReturnFundsHandler implements EffectHandler {
  readonly effectType = EFFECT_RETURN_FUNDS;
  readonly name = 'RETURN_FUNDS';

  async handle(request: EffectRequestMessage): Promise<EffectHandlerResult> {
    const startTime = Date.now();

    try {
      // 1. Decode amount from payload
      const amount = decodeAmountPayload(request.payload as Hex);
      log.info({
        strategyAddress: request.strategyAddress,
        amount: amount.toString(),
        msg: 'Processing RETURN_FUNDS effect',
      });

      // 2. Look up strategy and vault config
      const strategyId = await getStrategyIdFromAddress(request.strategyAddress);
      const dbClient = getDatabaseClient();
      const vaultInfo = await dbClient.getStrategyVaultInfo(strategyId);

      if (!vaultInfo) {
        log.error({ strategyId, msg: 'Vault not configured for strategy' });
        return {
          ok: false,
          data: '0x' as Hex,
        };
      }

      // Currently only EVM vaults are supported
      const vaultConfig = vaultInfo.vaultConfig;
      if (vaultConfig.type !== 'evm') {
        log.error({ strategyId, vaultType: vaultConfig.type, msg: 'Non-EVM vault not supported' });
        return {
          ok: false,
          data: '0x' as Hex,
        };
      }

      // 3. Sign the transaction via signer service
      const signerClient = getSignerClient();
      const signResult = await signerClient.signVaultReturnFunds({
        strategyId,
        amount: amount.toString(),
      });

      // 4. Broadcast to public chain
      const publicClient = createVaultPublicClient(vaultConfig.chainId);
      const txHash = await publicClient.sendRawTransaction({
        serializedTransaction: signResult.signedTransaction,
      });

      // 5. Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
      });

      if (receipt.status === 'reverted') {
        log.error({
          strategyId,
          txHash,
          msg: 'RETURN_FUNDS transaction reverted',
        });
        return {
          ok: false,
          data: '0x' as Hex,
        };
      }

      // 6. Reimburse operator for gas costs
      await reimburseOperatorGas(
        strategyId,
        vaultConfig.chainId,
        receipt.gasUsed,
        receipt.effectiveGasPrice
      );

      // 7. Return success with actual amount
      const actualAmount = amount;

      log.info({
        strategyId,
        txHash,
        amount: actualAmount.toString(),
        durationMs: Date.now() - startTime,
        msg: 'RETURN_FUNDS effect completed',
      });

      return {
        ok: true,
        data: encodeAmountResult(actualAmount),
      };
    } catch (error) {
      log.error({
        strategyAddress: request.strategyAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        msg: 'RETURN_FUNDS effect failed',
      });

      return {
        ok: false,
        data: '0x' as Hex,
      };
    }
  }
}
