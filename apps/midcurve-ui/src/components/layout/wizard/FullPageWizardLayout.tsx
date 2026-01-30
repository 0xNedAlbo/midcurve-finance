'use client';

import { useNavigate } from 'react-router-dom';
import { WizardHeader } from './WizardHeader';

export interface WizardStep {
  id: string;
  label: string;
}

export interface FullPageWizardLayoutProps {
  title: string;
  steps: WizardStep[];
  currentStep: number;
  onClose?: () => void;
  interactiveContent: React.ReactNode;
  visualContent: React.ReactNode;
  summaryContent: React.ReactNode;
  className?: string;
}

export function FullPageWizardLayout({
  title,
  steps,
  currentStep,
  onClose,
  interactiveContent,
  visualContent,
  summaryContent,
  className = '',
}: FullPageWizardLayoutProps) {
  const navigate = useNavigate();

  const handleClose = () => {
    onClose?.();
    navigate(-1);
  };

  return (
    <div
      className={`h-screen flex flex-col bg-gradient-to-br from-slate-900 to-slate-800 ${className}`}
    >
      {/* Header */}
      <WizardHeader
        title={title}
        steps={steps}
        currentStep={currentStep}
        onClose={handleClose}
      />

      {/* Content Area - fills remaining space */}
      <div className="flex-1 p-6 min-h-0">
        <div className="h-full flex flex-col lg:flex-row gap-6">
          {/* Left Column - Golden Ratio Major (61.8%) */}
          <div className="w-full lg:w-[61.8%] h-full flex flex-col gap-6 min-h-0">
            {/* Interactive Content - sizes to content */}
            <div className="shrink-0 relative z-10">
              <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6">
                {interactiveContent}
              </div>
            </div>

            {/* Visual Content - fills remaining space */}
            <div className="flex-1 min-h-0">
              <div className="h-full bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6 overflow-auto">
                {visualContent}
              </div>
            </div>
          </div>

          {/* Right Column - Golden Ratio Minor (38.2%) */}
          <div className="w-full lg:w-[38.2%] h-full min-h-0">
            <div className="h-full bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6 overflow-auto">
              {summaryContent}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
