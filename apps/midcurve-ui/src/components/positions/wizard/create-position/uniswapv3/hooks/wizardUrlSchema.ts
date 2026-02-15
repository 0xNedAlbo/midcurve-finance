/**
 * URL Schema for CreatePositionWizard
 *
 * Defines URL parameter parsing and serialization for shareable/bookmarkable wizard URLs.
 *
 * URL Format:
 * /positions/create?chain=1&pool=0x8ad5...&q=1&base=1.5&quote=3000&tl=-887220&tu=-184200&sl=-900000&tp=-180000&step=1&tab=range
 *
 * Parameters:
 * - chain: Chain ID (required for hydration)
 * - pool: Pool address (required for hydration)
 * - q: isToken0Quote flag (0=no, 1=yes, default: 0)
 * - base: Base token input amount (human-readable decimal)
 * - quote: Quote token input amount (human-readable decimal)
 * - tl: tickLower (signed integer)
 * - tu: tickUpper (signed integer)
 * - sl: stopLossTick (signed integer, null if not set)
 * - tp: takeProfitTick (signed integer, null if not set)
 * - step: currentStepIndex (0-5)
 * - tab: configurationTab (capital/range/sltp)
 */

import type { ConfigurationTab, CreatePositionWizardState } from '../context/CreatePositionWizardContext';

// Supported chain IDs for validation
const SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 137, 10] as const;

/**
 * Parsed URL parameters for the wizard
 */
export interface WizardUrlParams {
  chainId: number | null;
  poolAddress: string | null;
  isToken0Quote: boolean;
  baseInputAmount: string;
  quoteInputAmount: string;
  tickLower: number | null;
  tickUpper: number | null;
  stopLossTick: number | null;
  takeProfitTick: number | null;
  currentStepIndex: number;
  configurationTab: ConfigurationTab;
}

/**
 * Parse URL search params into typed wizard params
 */
export function parseWizardUrlParams(searchParams: URLSearchParams): WizardUrlParams {
  // Parse chain and pool (required for hydration)
  const chainStr = searchParams.get('chain');
  const chainId = chainStr ? parseInt(chainStr, 10) : null;
  const poolAddress = searchParams.get('pool');

  // Parse token role (default: token0 is base, not quote)
  const qStr = searchParams.get('q');
  const isToken0Quote = qStr === '1';

  // Parse capital amounts (human-readable decimals)
  const baseInputAmount = searchParams.get('base') || '';
  const quoteInputAmount = searchParams.get('quote') || '';

  // Parse ticks (null means use defaults)
  const tlStr = searchParams.get('tl');
  const tuStr = searchParams.get('tu');
  const tickLower = tlStr ? parseInt(tlStr, 10) : null;
  const tickUpper = tuStr ? parseInt(tuStr, 10) : null;

  // Parse SL/TP ticks (null means disabled)
  const slStr = searchParams.get('sl');
  const tpStr = searchParams.get('tp');
  const stopLossTick = slStr ? parseInt(slStr, 10) : null;
  const takeProfitTick = tpStr ? parseInt(tpStr, 10) : null;

  // Parse navigation state
  const stepStr = searchParams.get('step');
  const currentStepIndex = stepStr ? Math.max(0, Math.min(5, parseInt(stepStr, 10))) : 0;

  const tabStr = searchParams.get('tab');
  const validTabs: ConfigurationTab[] = ['capital', 'range', 'sltp'];
  const configurationTab = validTabs.includes(tabStr as ConfigurationTab)
    ? (tabStr as ConfigurationTab)
    : 'capital';

  return {
    chainId: Number.isNaN(chainId) ? null : chainId,
    poolAddress,
    isToken0Quote,
    baseInputAmount,
    quoteInputAmount,
    tickLower: Number.isNaN(tickLower) ? null : tickLower,
    tickUpper: Number.isNaN(tickUpper) ? null : tickUpper,
    stopLossTick: Number.isNaN(stopLossTick) ? null : stopLossTick,
    takeProfitTick: Number.isNaN(takeProfitTick) ? null : takeProfitTick,
    currentStepIndex: Number.isNaN(currentStepIndex) ? 0 : currentStepIndex,
    configurationTab,
  };
}

/**
 * Serialize wizard state to URL search params
 * Only includes non-default values to keep URLs short
 */
export function serializeWizardState(state: CreatePositionWizardState): URLSearchParams {
  const params = new URLSearchParams();

  // Only serialize if pool is selected
  if (!state.selectedPool) return params;

  // Required pool identification
  params.set('chain', String(state.selectedPool.chainId));
  params.set('pool', state.selectedPool.poolAddress);

  // Token role - only set if token0 is quote (since default is token0=base)
  const isToken0Quote = state.quoteToken?.address.toLowerCase() === state.selectedPool.token0.address.toLowerCase();
  if (isToken0Quote) {
    params.set('q', '1');
  }

  // Capital amounts - only if non-empty
  if (state.baseInputAmount) {
    params.set('base', state.baseInputAmount);
  }
  if (state.quoteInputAmount) {
    params.set('quote', state.quoteInputAmount);
  }

  // Tick range - only if custom range is set (not default 0,0)
  if (state.tickLower !== 0 || state.tickUpper !== 0) {
    params.set('tl', String(state.tickLower));
    params.set('tu', String(state.tickUpper));
  }

  // SL/TP - only if enabled
  if (state.stopLossEnabled && state.stopLossTick !== null) {
    params.set('sl', String(state.stopLossTick));
  }
  if (state.takeProfitEnabled && state.takeProfitTick !== null) {
    params.set('tp', String(state.takeProfitTick));
  }

  // Navigation - only if not at start
  if (state.currentStepIndex > 0) {
    params.set('step', String(state.currentStepIndex));
  }

  // Configuration tab - only if not capital (default) and we're on config step
  if (state.currentStepIndex === 1 && state.configurationTab !== 'capital') {
    params.set('tab', state.configurationTab);
  }

  return params;
}

/**
 * Validate pool address format (0x + 40 hex chars)
 */
export function isValidPoolAddress(address: string | null): address is string {
  if (!address) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate chain ID is supported
 */
export function isValidChainId(chainId: number | null): chainId is number {
  if (chainId === null) return false;
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

/**
 * Get chain name from chain ID
 */
export function getChainName(chainId: number): string {
  const chains: Record<number, string> = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    8453: 'Base',
    137: 'Polygon',
    10: 'Optimism',
  };
  return chains[chainId] ?? `Chain ${chainId}`;
}
