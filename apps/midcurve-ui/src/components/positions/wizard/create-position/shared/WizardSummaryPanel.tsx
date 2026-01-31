import { useCallback } from 'react';
import { PlusCircle, MinusCircle } from 'lucide-react';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { StepNavigationButtons } from './StepNavigationButtons';
import { SelectedPoolSummary } from './SelectedPoolSummary';

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

interface WizardSummaryPanelProps {
  showSkip?: boolean;
  onSkip?: () => void;
  skipLabel?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
  showFinish?: boolean;
  onFinish?: () => void;
  children?: React.ReactNode;
}

export function WizardSummaryPanel({
  showSkip,
  onSkip,
  skipLabel,
  nextLabel,
  nextDisabled,
  onNext,
  showFinish,
  onFinish,
  children,
}: WizardSummaryPanelProps) {
  const { state, setSummaryZoom } = useCreatePositionWizard();

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setSummaryZoom(Math.min(state.summaryZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.summaryZoom, setSummaryZoom]);

  const handleZoomOut = useCallback(() => {
    setSummaryZoom(Math.max(state.summaryZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.summaryZoom, setSummaryZoom]);

  return (
    <div className="h-full flex flex-col">
      {/* Header with zoom controls */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Summary</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            disabled={state.summaryZoom <= ZOOM_MIN}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.summaryZoom <= ZOOM_MIN
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom out"
          >
            <MinusCircle className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomIn}
            disabled={state.summaryZoom >= ZOOM_MAX}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.summaryZoom >= ZOOM_MAX
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom in"
          >
            <PlusCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto">
        {/* Selected Pool Summary */}
        <SelectedPoolSummary
          selectedPool={state.selectedPool}
          discoveredPool={state.discoveredPool}
          isDiscovering={state.isDiscovering}
          discoverError={state.discoverError}
        />

        {/* Custom content from step */}
        {children}
      </div>

      {/* Navigation Buttons */}
      <StepNavigationButtons
        showSkip={showSkip}
        onSkip={onSkip}
        skipLabel={skipLabel}
        nextLabel={nextLabel}
        nextDisabled={nextDisabled}
        onNext={onNext}
        showFinish={showFinish}
        onFinish={onFinish}
      />
    </div>
  );
}
