import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';

interface StepNavigationButtonsProps {
  showSkip?: boolean;
  onSkip?: () => void;
  skipLabel?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
  showFinish?: boolean;
  onFinish?: () => void;
}

export function StepNavigationButtons({
  showSkip = false,
  onSkip,
  skipLabel = 'Skip',
  nextLabel = 'Next',
  nextDisabled = false,
  onNext,
  showFinish = false,
  onFinish,
}: StepNavigationButtonsProps) {
  const { goBack, goNext, canGoBack, canGoNext, currentStep, isStepValid } =
    useCreatePositionWizard();

  const handleNext = () => {
    if (onNext) {
      onNext();
    } else {
      goNext();
    }
  };

  const handleFinish = () => {
    if (onFinish) {
      onFinish();
    }
  };

  const isCurrentStepValid = isStepValid(currentStep.id);
  const isNextDisabled = nextDisabled || (!isCurrentStepValid && !showSkip);

  return (
    <div className="flex gap-3 mt-6 pt-4 border-t border-slate-700/50">
      <button
        onClick={goBack}
        disabled={!canGoBack}
        className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Back
      </button>

      {showSkip && (
        <button
          onClick={onSkip || goNext}
          className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
        >
          {skipLabel}
        </button>
      )}

      {showFinish ? (
        <button
          onClick={handleFinish}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors cursor-pointer"
        >
          View Position
        </button>
      ) : (
        <button
          onClick={handleNext}
          disabled={isNextDisabled || !canGoNext}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {nextLabel}
        </button>
      )}
    </div>
  );
}
