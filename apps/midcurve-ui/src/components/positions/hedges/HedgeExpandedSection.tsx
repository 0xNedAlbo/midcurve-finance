/**
 * HedgeExpandedSection - Container for expanded Position + Hedges view
 *
 * Shows when the HedgeButton is expanded:
 * - "Position" label + PositionSubCard (original PnL curve)
 * - "Hedges" label + list of HedgeListItems
 */

'use client';

import type { ListPositionData } from '@midcurve/api-shared';
import { PositionSubCard } from './PositionSubCard';
import { HedgeListItem } from './HedgeListItem';
import { MOCK_HEDGES } from './mock-hedge-data';

interface HedgeExpandedSectionProps {
  position: ListPositionData;
}

export function HedgeExpandedSection({ position }: HedgeExpandedSectionProps) {
  // Extract quote token symbol for hedge display
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  return (
    <div className="mt-4 pt-4 border-t border-slate-700/50">
      <div className="border-l-2 border-cyan-500/50 pl-4">
        {/* Position Section */}
        <div className="mb-4">
          <h4 className="text-xs font-medium text-slate-400 mb-2">Position</h4>
          <PositionSubCard position={position} />
        </div>

        {/* Hedges Section */}
        <div>
          <h4 className="text-xs font-medium text-slate-400 mb-2">Hedges</h4>
          <div>
            {MOCK_HEDGES.map((hedge) => (
              <HedgeListItem
                key={hedge.id}
                hedge={hedge}
                quoteSymbol={quoteToken.symbol}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
