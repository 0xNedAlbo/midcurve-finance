import { Plus, Minus } from 'lucide-react';

interface ZoomControlsProps {
  label: string;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  minZoom?: number;
  maxZoom?: number;
}

export function ZoomControls({
  label,
  zoom,
  onZoomIn,
  onZoomOut,
  minZoom = 0.75,
  maxZoom = 1.25,
}: ZoomControlsProps) {
  const canZoomIn = zoom < maxZoom;
  const canZoomOut = zoom > minZoom;
  const percentage = Math.round(zoom * 100);

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-400">{label}</span>
      <button
        onClick={onZoomOut}
        disabled={!canZoomOut}
        className="p-1 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`Zoom out ${label.toLowerCase()}`}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="text-xs text-slate-300 w-8 text-center">{percentage}%</span>
      <button
        onClick={onZoomIn}
        disabled={!canZoomIn}
        className="p-1 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`Zoom in ${label.toLowerCase()}`}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
