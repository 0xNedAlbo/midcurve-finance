/**
 * PnlStatement - Hierarchical P&L with expandable instrument/position rows.
 *
 * Level 0: Portfolio totals (always visible)
 * Level 1: Instrument rows (expandable, 4-category breakdown)
 * Level 2: Position rows (expandable, 4-category breakdown)
 */

import { useState } from 'react';
import type { PnlResponse, PnlInstrumentItem, PnlPositionItem } from '@midcurve/api-shared';
import { formatReportingAmount } from '@midcurve/shared';

interface PnlStatementProps {
  data: PnlResponse | undefined;
}

export function PnlStatement({ data }: PnlStatementProps) {
  if (!data) {
    return (
      <div className="text-center py-12 text-slate-400">
        No P&L data available. Track positions to get started.
      </div>
    );
  }

  const hasInstruments = data.instruments.length > 0;

  return (
    <div className="space-y-1">
      {/* Instrument rows */}
      {hasInstruments ? (
        data.instruments.map((instrument) => (
          <InstrumentRow key={instrument.instrumentRef} instrument={instrument} />
        ))
      ) : (
        <div className="text-center py-8 text-slate-400">
          No activity in this period.
        </div>
      )}

      {/* Portfolio totals */}
      {hasInstruments && (
        <div className="border-t border-slate-600 pt-3 mt-4">
          <div className="flex justify-between items-center px-4 py-2">
            <span className="text-white font-semibold">Net P&L (Period)</span>
            <span className={`text-lg font-bold ${pnlColor(data.netPnl)}`}>
              {formatPnl(data.netPnl)}
            </span>
          </div>
          <div className="flex gap-6 px-4 text-xs text-slate-400">
            <span>
              Realized: <span className={pnlColor(addBigints(data.realizedFromWithdrawals, data.realizedFromCollectedFees))}>{formatPnl(addBigints(data.realizedFromWithdrawals, data.realizedFromCollectedFees))}</span>
            </span>
            <span>
              Unrealized: <span className={pnlColor(addBigints(data.unrealizedFromPriceChanges, data.unrealizedFromUnclaimedFees))}>{formatPnl(addBigints(data.unrealizedFromPriceChanges, data.unrealizedFromUnclaimedFees))}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Instrument Row (Level 1)
// =============================================================================

function InstrumentRow({ instrument }: { instrument: PnlInstrumentItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex justify-between items-center px-4 py-3 hover:bg-slate-800/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-500 text-xs">{expanded ? '▼' : '▶'}</span>
          <span className="text-slate-300 font-medium">
            {instrument.poolSymbol}
          </span>
          <span className="text-slate-500 text-xs">
            {instrument.protocol} · {instrument.feeTier !== '0' ? `${Number(instrument.feeTier) / 100}%` : ''}
          </span>
        </div>
        <span className={`font-semibold ${pnlColor(instrument.netPnl)}`}>
          {formatPnl(instrument.netPnl)}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-700/30 bg-slate-900/30">
          {/* Instrument-level breakdown */}
          <CategoryBreakdown
            realizedFromWithdrawals={instrument.realizedFromWithdrawals}
            realizedFromCollectedFees={instrument.realizedFromCollectedFees}
            unrealizedFromPriceChanges={instrument.unrealizedFromPriceChanges}
            unrealizedFromUnclaimedFees={instrument.unrealizedFromUnclaimedFees}
            indent={1}
          />

          {/* Position rows */}
          {instrument.positions.length > 1 && (
            <div className="border-t border-slate-700/20 mt-2">
              {instrument.positions.map((position) => (
                <PositionRow key={position.positionRef} position={position} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Position Row (Level 2)
// =============================================================================

function PositionRow({ position }: { position: PnlPositionItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex justify-between items-center px-4 pl-8 py-2 hover:bg-slate-800/30 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-600 text-xs">{expanded ? '▼' : '▶'}</span>
          <span className="text-slate-400 text-sm">NFT ID #{position.nftId}</span>
        </div>
        <span className={`text-sm ${pnlColor(position.netPnl)}`}>
          {formatPnl(position.netPnl)}
        </span>
      </button>

      {expanded && (
        <div className="bg-slate-900/20">
          <CategoryBreakdown
            realizedFromWithdrawals={position.realizedFromWithdrawals}
            realizedFromCollectedFees={position.realizedFromCollectedFees}
            unrealizedFromPriceChanges={position.unrealizedFromPriceChanges}
            unrealizedFromUnclaimedFees={position.unrealizedFromUnclaimedFees}
            indent={2}
          />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Category Breakdown (reusable at both levels)
// =============================================================================

interface CategoryBreakdownProps {
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  unrealizedFromPriceChanges: string;
  unrealizedFromUnclaimedFees: string;
  indent: number;
}

function CategoryBreakdown({
  realizedFromWithdrawals,
  realizedFromCollectedFees,
  unrealizedFromPriceChanges,
  unrealizedFromUnclaimedFees,
  indent,
}: CategoryBreakdownProps) {
  const pl = indent === 1 ? 'pl-10' : 'pl-14';

  return (
    <div className={`${pl} pr-4 py-2 space-y-0.5 text-xs`}>
      <div className="text-slate-500 font-medium mb-1">Realized Gains / (Losses)</div>
      <CategoryLine label="From Withdrawals" value={realizedFromWithdrawals} />
      <CategoryLine label="From Collected Fees" value={realizedFromCollectedFees} />
      <div className="text-slate-500 font-medium mt-2 mb-1">Unrealized Gains / (Losses)</div>
      <CategoryLine label="From Price Changes" value={unrealizedFromPriceChanges} />
      <CategoryLine label="From Unclaimed Fees" value={unrealizedFromUnclaimedFees} />
    </div>
  );
}

function CategoryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-slate-400">{label}</span>
      <span className={pnlColor(value)}>{formatPnl(value)}</span>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function formatPnl(value: string): string {
  const n = BigInt(value);
  const prefix = n > 0n ? '+' : '';
  return `${prefix}${formatReportingAmount(value)}`;
}

function pnlColor(value: string): string {
  const n = BigInt(value);
  if (n < 0n) return 'text-red-400';
  if (n > 0n) return 'text-emerald-400';
  return 'text-slate-400';
}

function addBigints(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}
