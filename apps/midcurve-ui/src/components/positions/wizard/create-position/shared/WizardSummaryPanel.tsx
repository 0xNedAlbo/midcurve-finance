import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { StepNavigationButtons } from './StepNavigationButtons';
import { SelectedPoolSummary } from './SelectedPoolSummary';

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
  const { state } = useCreatePositionWizard();

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Summary</h3>

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
