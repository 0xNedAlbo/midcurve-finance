/**
 * UniswapV3PositionInfo - Protocol-specific position details for UniswapV3
 *
 * Displays Uniswap V3-specific information:
 * - NFT ID
 * - Chain name
 * - Token pair
 * - Fee tier
 *
 * Used in modals and detail views where protocol-specific information
 * needs to be displayed.
 */

import type { ListPositionData } from '@midcurve/api-shared';
import { InfoRow } from '../../info-row';
import { formatChainName } from '@/lib/position-helpers';

interface UniswapV3PositionInfoProps {
  position: ListPositionData;
}

export function UniswapV3PositionInfo({ position }: UniswapV3PositionInfoProps) {
  // Extract UniswapV3-specific config
  const config = position.config as {
    chainId: number;
    nftId: number;
  };

  // Get token symbols
  const token0Symbol = position.pool.token0.symbol;
  const token1Symbol = position.pool.token1.symbol;

  // Fee is in basis points (feeBps), convert to percentage
  // Example: 3000 bps = 0.30%
  const feePercentage = (position.pool.feeBps / 10000).toFixed(2);

  return (
    <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
      <InfoRow label="NFT ID" value={`#${config.nftId}`} />
      <InfoRow label="Chain" value={formatChainName(config.chainId)} valueClassName="text-sm text-white" />
      <InfoRow label="Token Pair" value={`${token0Symbol}/${token1Symbol}`} valueClassName="text-sm text-white" />
      <InfoRow label="Fee Tier" value={`${feePercentage}%`} />
    </div>
  );
}
