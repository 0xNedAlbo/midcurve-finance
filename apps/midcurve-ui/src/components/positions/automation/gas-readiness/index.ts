/**
 * Gas Readiness Gate
 *
 * One shared set of components, used by every close-order registration flow.
 * See GasReadinessSteps.tsx for the three insertion sites and why that count
 * is three rather than four.
 */

export {
  useGasReadinessSteps,
  type GasReadinessStepsProps,
  type GasReadinessStepsResult,
} from './GasReadinessSteps';
export { GasReadinessExplainer } from './GasReadinessExplainer';
