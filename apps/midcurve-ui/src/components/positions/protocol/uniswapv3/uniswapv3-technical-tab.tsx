"use client";

import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import { tickToSqrtRatioX96 } from "@midcurve/shared";
import { CopyableField } from "@/components/ui/copyable-field";
import { DisplayField } from "@/components/ui/display-field";
import { getChainMetadataByChainId } from "@/config/chains";
import { getNonfungiblePositionManagerAddress } from "@/config/contracts/nonfungible-position-manager";

interface UniswapV3TechnicalTabProps {
  position: GetUniswapV3PositionResponse;
}

/**
 * UniswapV3 Technical Details Tab
 *
 * Displays comprehensive technical information about a Uniswap V3 position:
 * - Pool and token contract addresses
 * - Position configuration (NFT ID, ticks, liquidity)
 * - Pool state (current tick, sqrt price, fee tier)
 * - Owner information
 *
 * All addresses are displayed with:
 * - Copy-to-clipboard functionality
 * - Links to blockchain explorers
 * - Monospace formatting for readability
 */
export function UniswapV3TechnicalTab({ position }: UniswapV3TechnicalTabProps) {
  // Extract chain metadata for explorer URLs
  const chainId = position.config.chainId;
  const chainMetadata = getChainMetadataByChainId(Number(chainId));
  const explorerUrl = chainMetadata?.explorer;

  // Extract addresses
  const poolAddress = position.pool.config.address;
  const token0Address = position.pool.config.token0;
  const token1Address = position.pool.config.token1;
  const ownerAddress = position.state.ownerAddress;
  const nfPositionManagerAddress = getNonfungiblePositionManagerAddress(Number(chainId));

  // Extract pool config
  const feeBps = position.pool.config.feeBps;
  const tickSpacing = position.pool.config.tickSpacing;

  // Extract pool state
  const currentTick = position.pool.state.currentTick;
  const sqrtPriceX96 = position.pool.state.sqrtPriceX96;

  // Extract position config
  const nftId = position.config.nftId;
  const tickLower = position.config.tickLower;
  const tickUpper = position.config.tickUpper;

  // Extract position state
  const liquidity = position.state.liquidity;

  // Calculate sqrtRatioX96 from current tick
  const calculatedSqrtRatioX96 = tickToSqrtRatioX96(Number(currentTick));

  // Determine token roles (quote vs base)
  const token0IsQuote = position.isToken0Quote;
  const token0Symbol = position.pool.token0.symbol;
  const token1Symbol = position.pool.token1.symbol;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column - Basic Information */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white mb-4">Basic Information</h3>

          <CopyableField
            label="Pool Contract"
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

          <CopyableField label="Pool Fee (bps)" value={feeBps.toString()} />

          <CopyableField
            label="Current Price"
            value={sqrtPriceX96}
          />

          <CopyableField
            label="SqrtRatioX96 (calculated)"
            value={calculatedSqrtRatioX96.toString()}
          />

          <CopyableField label="Current Tick" value={currentTick.toString()} />

          <CopyableField label="Tick Spacing" value={tickSpacing.toString()} />
        </div>

        {/* Right Column - Position Data */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white mb-4">Position Data</h3>

          <CopyableField label="NFT ID" value={nftId.toString()} />

          <DisplayField
            label={`Token 0 (${token0Symbol})`}
            value={token0IsQuote ? "Quote Token" : "Base Token"}
          />

          <DisplayField
            label={`Token 1 (${token1Symbol})`}
            value={token0IsQuote ? "Base Token" : "Quote Token"}
          />

          <CopyableField label="Liquidity L" value={liquidity} />

          <CopyableField label="Tick Lower" value={tickLower.toString()} />

          <CopyableField label="Tick Upper" value={tickUpper.toString()} />

          {nfPositionManagerAddress && (
            <CopyableField
              label="NFPositionManager Contract"
              value={nfPositionManagerAddress}
              href={
                explorerUrl
                  ? `${explorerUrl}/address/${nfPositionManagerAddress}`
                  : undefined
              }
              isAddress={true}
            />
          )}

          <CopyableField
            label="Owner"
            value={ownerAddress}
            href={explorerUrl ? `${explorerUrl}/address/${ownerAddress}` : undefined}
            isAddress={true}
          />
        </div>
      </div>
    </div>
  );
}
