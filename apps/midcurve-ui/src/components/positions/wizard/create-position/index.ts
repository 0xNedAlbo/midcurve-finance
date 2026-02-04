// Main wizard component
export { CreatePositionWizard } from './CreatePositionWizard';

// Context
export {
  CreatePositionWizardProvider,
  useCreatePositionWizard,
  getVisibleSteps,
  type TransactionRecord,
  type CreatePositionWizardState,
  type ConfigurationTab,
  type PoolSelectionTab,
} from './context/CreatePositionWizardContext';

// Re-export pool types from API shared
export type { PoolSearchResultItem, PoolSearchTokenInfo } from '@midcurve/api-shared';

// Steps (for direct access if needed)
export { PoolSelectionStep } from './steps/PoolSelectionStep';
export { PositionConfigStep } from './steps/PositionConfigStep';
export { SwapStep } from './steps/SwapStep';
export { AutowalletStep } from './steps/AutowalletStep';
export { TransactionStep } from './steps/TransactionStep';
export { SummaryStep } from './steps/SummaryStep';

// Shared components
export { WizardSummaryPanel } from './shared/WizardSummaryPanel';
export { StepNavigationButtons } from './shared/StepNavigationButtons';
export { PoolTable } from './shared/PoolTable';
