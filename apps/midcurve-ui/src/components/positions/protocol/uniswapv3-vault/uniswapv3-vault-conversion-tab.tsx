"use client";

import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type { UniswapV3VaultPositionConfigResponse, UniswapV3VaultPositionStateResponse, LedgerEventData } from "@midcurve/api-shared";
import { ConversionSummary } from "../uniswapv3/conversion-summary";
import { useUniswapV3VaultLedger } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultLedger";
import { useUniswapV3ConversionSummary } from "@/hooks/positions/uniswapv3/useUniswapV3ConversionSummary";

interface UniswapV3VaultConversionTabProps {
  position: UniswapV3VaultPositionData;
}

/**
 * Adapt vault ledger events to the format expected by the NFT conversion hook.
 *
 * Vault events use different event types and field structures:
 * - VAULT_MINT / VAULT_TRANSFER_IN  → INCREASE_POSITION
 * - VAULT_BURN / VAULT_TRANSFER_OUT / VAULT_CLOSE_ORDER_EXECUTED → DECREASE_POSITION
 * - VAULT_COLLECT_YIELD → COLLECT
 *
 * Config: sharesAfter replaces liquidityAfter (totalSupply == nft liquidity invariant).
 * State: tokenAmounts[0/1] replaces amount0/amount1.
 */
function adaptVaultEvents(events: LedgerEventData[]): LedgerEventData[] {
  return events.map((event) => {
    const vaultConfig = event.config as Record<string, unknown>;
    const vaultState = event.state as Record<string, unknown>;
    const tokenAmounts = vaultState.tokenAmounts as string[];

    let mappedEventType: string;
    let feesCollected0 = "0";
    let feesCollected1 = "0";
    let amount0 = tokenAmounts?.[0] ?? "0";
    let amount1 = tokenAmounts?.[1] ?? "0";

    switch (event.eventType as string) {
      case "VAULT_MINT":
      case "VAULT_TRANSFER_IN":
        mappedEventType = "INCREASE_POSITION";
        break;
      case "VAULT_BURN":
      case "VAULT_TRANSFER_OUT":
      case "VAULT_CLOSE_ORDER_EXECUTED":
        mappedEventType = "DECREASE_POSITION";
        break;
      case "VAULT_COLLECT_YIELD":
        mappedEventType = "COLLECT";
        // Yield amounts are LP fees — map to feesCollected
        feesCollected0 = amount0;
        feesCollected1 = amount1;
        amount0 = "0";
        amount1 = "0";
        break;
      default:
        return event;
    }

    return {
      ...event,
      eventType: mappedEventType,
      config: {
        sqrtPriceX96: vaultConfig.sqrtPriceX96,
        liquidityAfter: vaultConfig.sharesAfter,
        feesCollected0,
        feesCollected1,
        blockNumber: vaultConfig.blockNumber,
        logIndex: vaultConfig.logIndex,
      },
      state: {
        eventType: mappedEventType,
        amount0,
        amount1,
      },
    } as LedgerEventData;
  });
}

export function UniswapV3VaultConversionTab({ position }: UniswapV3VaultConversionTabProps) {
  const config = position.config as UniswapV3VaultPositionConfigResponse;
  const state = position.state as UniswapV3VaultPositionStateResponse;

  const { data: ledgerEvents, isLoading } = useUniswapV3VaultLedger(
    config.chainId,
    config.vaultAddress,
    config.ownerAddress,
  );

  // Adapt vault position: sharesBalance is the user's proportional liquidity
  // (totalSupply == nft liquidity, so sharesBalance maps directly to liquidity)
  const adaptedPosition = {
    ...position,
    state: {
      ...position.state,
      liquidity: state.sharesBalance,
    },
  };

  const adaptedEvents = ledgerEvents ? adaptVaultEvents(ledgerEvents) : undefined;

  const summary = useUniswapV3ConversionSummary(
    adaptedPosition as unknown as Parameters<typeof useUniswapV3ConversionSummary>[0],
    adaptedEvents,
  );

  return (
    <ConversionSummary
      summary={summary}
      isLoading={isLoading}
    />
  );
}
