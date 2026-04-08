"use client";

import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
} from "@midcurve/api-shared";
import { tickToSqrtRatioX96 } from "@midcurve/shared";
import { CopyableField } from "@/components/ui/copyable-field";
import { DisplayField } from "@/components/ui/display-field";
import { getChainMetadataByChainId } from "@/config/chains";

interface UniswapV3VaultTechnicalTabProps {
  position: UniswapV3VaultPositionData;
}

/**
 * UniswapV3 Vault Technical Details Tab
 *
 * Displays comprehensive technical information about a vault position:
 * - Vault-specific config: vaultAddress, factoryAddress, underlyingTokenId, ownerAddress, poolAddress
 * - Vault-specific state: sharesBalance, totalSupply, liquidity, vaultDecimals
 * - Pool state: sqrtPriceX96, currentTick, poolLiquidity
 * - Token addresses and roles
 */
export function UniswapV3VaultTechnicalTab({ position }: UniswapV3VaultTechnicalTabProps) {
  const config = position.config as UniswapV3VaultPositionConfigResponse;
  const state = position.state as UniswapV3VaultPositionStateResponse;

  // Extract chain metadata for explorer URLs
  const chainMetadata = getChainMetadataByChainId(config.chainId);
  const explorerUrl = chainMetadata?.explorer;

  // Extract pool config
  const poolAddress = config.poolAddress;
  const token0Address = config.token0Address;
  const token1Address = config.token1Address;

  // Determine token roles (quote vs base)
  const token0IsQuote = position.isToken0Quote;
  const token0Symbol = position.pool.token0.symbol;
  const token1Symbol = position.pool.token1.symbol;

  // Calculate sqrtRatioX96 from current tick
  const calculatedSqrtRatioX96 = tickToSqrtRatioX96(state.currentTick);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column - Vault Configuration */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white mb-4">Vault Configuration</h3>

          <CopyableField
            label="Vault Address"
            value={config.vaultAddress}
            href={explorerUrl ? `${explorerUrl}/address/${config.vaultAddress}` : undefined}
            isAddress={true}
          />

          <CopyableField
            label="Factory Address"
            value={config.factoryAddress}
            href={explorerUrl ? `${explorerUrl}/address/${config.factoryAddress}` : undefined}
            isAddress={true}
          />

          <CopyableField
            label="Underlying Token ID"
            value={config.underlyingTokenId.toString()}
          />

          <CopyableField
            label="Owner Address"
            value={config.ownerAddress}
            href={explorerUrl ? `${explorerUrl}/address/${config.ownerAddress}` : undefined}
            isAddress={true}
          />

          <CopyableField
            label="Pool Address"
            value={poolAddress}
            href={explorerUrl ? `${explorerUrl}/address/${poolAddress}` : undefined}
            isAddress={true}
          />

          <CopyableField
            label="Token0 Address"
            value={token0Address}
            href={explorerUrl ? `${explorerUrl}/token/${token0Address}` : undefined}
            isAddress={true}
          />

          <CopyableField
            label="Token1 Address"
            value={token1Address}
            href={explorerUrl ? `${explorerUrl}/token/${token1Address}` : undefined}
            isAddress={true}
          />

          <DisplayField
            label={`Token 0 (${token0Symbol})`}
            value={token0IsQuote ? "Quote Token" : "Base Token"}
          />

          <DisplayField
            label={`Token 1 (${token1Symbol})`}
            value={token0IsQuote ? "Base Token" : "Quote Token"}
          />
        </div>

        {/* Right Column - Vault State & Pool State */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white mb-4">Vault State</h3>

          <CopyableField
            label="Shares Balance"
            value={state.sharesBalance}
          />

          <CopyableField
            label="Total Supply"
            value={state.totalSupply}
          />

          <CopyableField
            label="Vault Liquidity"
            value={state.liquidity}
          />

          <CopyableField
            label="Vault Decimals"
            value={config.vaultDecimals.toString()}
          />

          <CopyableField label="Tick Lower" value={config.tickLower.toString()} />

          <CopyableField label="Tick Upper" value={config.tickUpper.toString()} />

          <CopyableField label="Fee (bps)" value={config.feeBps.toString()} />

          <CopyableField label="Tick Spacing" value={config.tickSpacing.toString()} />

          {/* Pool State Section */}
          <h3 className="text-lg font-semibold text-white mb-4 mt-8">Pool State</h3>

          <CopyableField
            label="SqrtPriceX96"
            value={state.sqrtPriceX96}
          />

          <CopyableField
            label="SqrtRatioX96 (calculated)"
            value={calculatedSqrtRatioX96.toString()}
          />

          <CopyableField
            label="Current Tick"
            value={state.currentTick.toString()}
          />

          <CopyableField
            label="Pool Liquidity"
            value={state.poolLiquidity}
          />
        </div>
      </div>
    </div>
  );
}
