import { X } from 'lucide-react';
import { WizardStepDots } from './WizardStepDots';
import type { WizardStep } from './FullPageWizardLayout';

interface WizardHeaderProps {
  title: string;
  steps: WizardStep[];
  currentStep: number;
  onClose: () => void;
}

export function WizardHeader({
  title,
  steps,
  currentStep,
  onClose,
}: WizardHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-white">{title}</h1>
        <WizardStepDots steps={steps} currentStep={currentStep} />
      </div>
      <button
        onClick={onClose}
        className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
        aria-label="Close wizard"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
