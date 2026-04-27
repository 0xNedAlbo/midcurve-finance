/**
 * Pool Table Column Manager
 *
 * Gear icon + portal-rendered popover that lets the user toggle which metric
 * columns are visible in the pool search table. Persists immediately via the
 * `useUpdatePoolTableColumns` mutation; optimistic update keeps it snappy.
 *
 * The popover renders into `document.body` via `createPortal` so it escapes
 * any parent overflow/clipping context (e.g. the surrounding section card).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Check } from 'lucide-react';
import type { PoolTableColumnId } from '@midcurve/shared';
import { useUpdatePoolTableColumns } from '@/hooks/user-settings/usePoolTableColumns';

interface PoolTableColumnManagerProps {
  visibleColumns: PoolTableColumnId[];
}

interface ColumnDef {
  id: PoolTableColumnId;
  label: string;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: 'tvl', label: 'TVL' },
  { id: 'feeApr7d', label: 'Fee APR (7d)' },
  { id: 'lvrCoverage', label: 'LVR-Coverage' },
];

const ADDITIONAL_COLUMNS: ColumnDef[] = [
  { id: 'volume7dAvg', label: 'Volume (7d avg)' },
  { id: 'fees24h', label: 'Fees (24h)' },
  { id: 'lvrThreshold', label: 'LVR threshold (σ²/8)' },
  { id: 'margin', label: 'Margin' },
  { id: 'coverageRatio', label: 'Coverage ratio' },
  { id: 'sigmaPair365d', label: 'σ pair (365d)' },
  { id: 'velocity', label: 'Velocity (60d/365d)' },
  { id: 'verdict60d', label: 'Verdict (60d)' },
  { id: 'verdictAgreement', label: 'Verdict agreement' },
];

const ITEMS_PER_COLUMN = 4;

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}


export function PoolTableColumnManager({ visibleColumns }: PoolTableColumnManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const updateMutation = useUpdatePoolTableColumns();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const visibleSet = new Set<PoolTableColumnId>(visibleColumns);

  const toggle = (id: PoolTableColumnId) => {
    const next = new Set(visibleSet);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    // Preserve canonical order: defaults first, then additional, both in
    // their declaration order. This matches how PoolTable renders.
    const ordered: PoolTableColumnId[] = [
      ...DEFAULT_COLUMNS.map((c) => c.id),
      ...ADDITIONAL_COLUMNS.map((c) => c.id),
    ].filter((cid) => next.has(cid));

    updateMutation.mutate(ordered);
  };

  const renderRow = ({ id, label }: ColumnDef) => {
    const checked = visibleSet.has(id);
    return (
      <button
        key={id}
        type="button"
        onClick={() => toggle(id)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-700/50 cursor-pointer rounded transition-colors"
      >
        <span
          className={`w-4 h-4 flex items-center justify-center rounded border ${
            checked
              ? 'bg-blue-600 border-blue-600'
              : 'bg-transparent border-slate-500'
          }`}
        >
          {checked && <Check className="w-3 h-3 text-white" />}
        </span>
        <span>{label}</span>
      </button>
    );
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 cursor-pointer transition-colors"
        title="Manage visible columns"
        aria-label="Manage visible columns"
        aria-expanded={isOpen}
      >
        <Settings className="w-4 h-4" />
      </button>

      {isOpen &&
        mounted &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-50 flex bg-slate-800/95 border border-slate-700 rounded-lg p-2 shadow-xl backdrop-blur-sm"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
            }}
            role="menu"
          >
            {[
              { title: 'Default columns', items: DEFAULT_COLUMNS },
              { title: 'Additional columns', items: ADDITIONAL_COLUMNS },
            ].map((section, sectionIdx) => (
              <div
                key={section.title}
                className={`flex flex-col ${
                  sectionIdx > 0 ? 'border-l border-slate-700/50 pl-2 ml-2' : ''
                }`}
              >
                <div className="px-3 py-1.5 text-xs uppercase tracking-wide text-slate-500">
                  {section.title}
                </div>
                <div className="flex gap-2">
                  {chunk(section.items, ITEMS_PER_COLUMN).map((group, groupIdx) => (
                    <div
                      key={groupIdx}
                      className="flex flex-col min-w-[200px]"
                    >
                      {group.map(renderRow)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
