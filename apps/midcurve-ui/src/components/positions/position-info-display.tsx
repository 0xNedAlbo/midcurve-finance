/**
 * PositionInfoDisplay - Protocol-agnostic position info dispatcher
 *
 * Routes to protocol-specific info components based on position.protocol.
 * Enables protocol-agnostic components (modals, detail views) to display
 * protocol-specific information without knowing implementation details.
 *
 * Pattern: Dispatcher component (protocol-agnostic wrapper)
 */

import type { ListPositionData } from '@midcurve/api-shared';
import { UniswapV3PositionInfo } from './protocol/uniswapv3/uniswapv3-position-info';
import { InfoRow } from './info-row';

interface PositionInfoDisplayProps {
  position: ListPositionData;
}

/**
 * Generic fallback for unsupported protocols
 */
function GenericPositionInfo({ position }: PositionInfoDisplayProps) {
  return (
    <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
      <InfoRow label="Position ID" value={position.id.slice(0, 8) + '...'} />
      <InfoRow
        label="Token Pair"
        value={`${position.pool.token0.symbol}/${position.pool.token1.symbol}`}
        valueClassName="text-sm text-white"
      />
      <InfoRow
        label="Protocol"
        value={position.protocol}
        valueClassName="text-sm text-white capitalize"
      />
    </div>
  );
}

/**
 * Dispatcher: Routes to protocol-specific implementation
 */
export function PositionInfoDisplay({ position }: PositionInfoDisplayProps) {
  switch (position.protocol) {
    case 'uniswapv3':
      return <UniswapV3PositionInfo position={position} />;

    // Future: Add Orca, Raydium, etc.
    // case 'orca':
    //   return <OrcaPositionInfo position={position} />;

    default:
      return <GenericPositionInfo position={position} />;
  }
}
