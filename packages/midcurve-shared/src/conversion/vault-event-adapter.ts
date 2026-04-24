/**
 * Adapt vault ledger events to the NFT-ledger event shape expected by
 * computeUniswapV3ConversionSummary.
 *
 * Vault events use different event types and field structures:
 * - VAULT_MINT / VAULT_TRANSFER_IN         → INCREASE_POSITION
 * - VAULT_BURN / VAULT_TRANSFER_OUT /
 *   VAULT_CLOSE_ORDER_EXECUTED             → DECREASE_POSITION
 * - VAULT_COLLECT_YIELD                    → COLLECT
 *
 * Config: sharesAfter replaces liquidityAfter (totalSupply == nft liquidity invariant).
 * State: tokenAmounts[0/1] replaces amount0/amount1.
 */

import type { ConversionLedgerEvent } from './uniswapv3-conversion.js';

/**
 * Minimal shape of a vault ledger event as emitted by the vault ledger API.
 * Kept structural so this function works against any serialized form that
 * follows the documented field naming.
 */
export interface VaultLedgerEventInput {
  timestamp: string;
  eventType: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  // Other fields (id, positionId, …) are tolerated but ignored.
  [key: string]: unknown;
}

export function adaptVaultEventsForConversion(
  events: VaultLedgerEventInput[],
): ConversionLedgerEvent[] {
  const adapted: ConversionLedgerEvent[] = [];

  for (const event of events) {
    const vaultConfig = event.config as Record<string, unknown>;
    const vaultState = event.state as Record<string, unknown>;
    const tokenAmounts = vaultState.tokenAmounts as string[] | undefined;

    let mappedEventType: string;
    let feesCollected0 = '0';
    let feesCollected1 = '0';
    let amount0 = tokenAmounts?.[0] ?? '0';
    let amount1 = tokenAmounts?.[1] ?? '0';

    switch (event.eventType) {
      case 'VAULT_MINT':
      case 'VAULT_TRANSFER_IN':
        mappedEventType = 'INCREASE_POSITION';
        break;
      case 'VAULT_BURN':
      case 'VAULT_TRANSFER_OUT':
      case 'VAULT_CLOSE_ORDER_EXECUTED':
        mappedEventType = 'DECREASE_POSITION';
        break;
      case 'VAULT_COLLECT_YIELD':
        mappedEventType = 'COLLECT';
        // Yield amounts are LP fees — map to feesCollected.
        feesCollected0 = amount0;
        feesCollected1 = amount1;
        amount0 = '0';
        amount1 = '0';
        break;
      default:
        // Skip events that do not map to a conversion-relevant type.
        continue;
    }

    adapted.push({
      timestamp: event.timestamp,
      eventType: mappedEventType,
      config: {
        sqrtPriceX96: String(vaultConfig.sqrtPriceX96 ?? '0'),
        liquidityAfter: String(vaultConfig.sharesAfter ?? '0'),
        feesCollected0,
        feesCollected1,
        blockNumber: String(vaultConfig.blockNumber ?? '0'),
        logIndex: Number(vaultConfig.logIndex ?? 0),
      },
      state: {
        eventType: mappedEventType,
        amount0,
        amount1,
      },
    });
  }

  return adapted;
}
