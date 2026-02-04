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
  // Zoom values using CSS zoom property (affects layout, controls are in step content)
  interactiveZoom?: number;
  summaryZoom?: number;
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
  interactiveZoom,
  summaryZoom,
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
      <div className="flex-1 p-6 min-h-0 overflow-hidden">
        <div className="h-full flex flex-row gap-6">
          {/* Left Column - expands to fill available space */}
          <div className="flex-1 min-w-0 h-full flex flex-col gap-6 min-h-0">
            {/* Interactive Content - fills space when no visual, otherwise sizes to content */}
            <div
              className={`${visualContent ? 'shrink-0' : 'flex-1'} relative z-10 bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6 overflow-hidden`}
              style={interactiveZoom && interactiveZoom !== 1 ? { zoom: interactiveZoom } : undefined}
            >
              {interactiveContent}
            </div>

            {/* Visual Content - fills remaining space (no zoom), hidden when null */}
            {visualContent && (
              <div className="flex-1 min-h-0 overflow-hidden">
                <div className="h-full bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6">
                  {visualContent}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - fixed width with min-width, shrinks with zoom */}
          <div
            className="h-full min-h-0 shrink-0 overflow-hidden"
            style={{
              width: summaryZoom ? `calc(380px * ${summaryZoom})` : '380px',
              minWidth: '280px',
            }}
          >
            <div
              className="h-full bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6 overflow-auto"
              style={summaryZoom && summaryZoom !== 1 ? { zoom: summaryZoom } : undefined}
            >
              {summaryContent}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
