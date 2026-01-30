import type { WizardStep } from './FullPageWizardLayout';

interface WizardStepDotsProps {
  steps: WizardStep[];
  currentStep: number;
}

export function WizardStepDots({ steps, currentStep }: WizardStepDotsProps) {
  return (
    <div
      className="flex items-center gap-2"
      role="progressbar"
      aria-valuenow={currentStep + 1}
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-label={`Step ${currentStep + 1} of ${steps.length}`}
    >
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={`w-2.5 h-2.5 rounded-full transition-colors ${
            index <= currentStep ? 'bg-blue-500' : 'bg-slate-600'
          }`}
          title={step.label}
          aria-label={`Step ${index + 1}: ${step.label}${index < currentStep ? ' (completed)' : index === currentStep ? ' (current)' : ''}`}
        />
      ))}
    </div>
  );
}
