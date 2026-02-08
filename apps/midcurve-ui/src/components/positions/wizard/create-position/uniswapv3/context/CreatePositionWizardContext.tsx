import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { PoolSearchResultItem, PoolSearchTokenInfo } from '@midcurve/api-shared';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { WizardStep } from '@/components/layout/wizard';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { ZOOM_STORAGE_KEYS, ZOOM_DEFAULTS } from '@/lib/zoom-settings';
import { useWizardUrlState, type HydrationPayload } from '../hooks/useWizardUrlState';

// ----- Types -----

export type ConfigurationTab = 'capital' | 'range' | 'sltp';
export type PoolSelectionTab = 'favorites' | 'search' | 'direct';

export interface TransactionRecord {
  hash: string;
  type: 'approval' | 'mint' | 'autowallet' | 'register-sl' | 'register-tp';
  label: string;
  status: 'pending' | 'confirming' | 'confirmed' | 'failed';
}

export interface CreatePositionWizardState {
  // Current step
  currentStepIndex: number;

  // Pool Selection (Step A)
  poolSelectionTab: PoolSelectionTab;
  selectedPool: PoolSearchResultItem | null;
  discoveredPool: UniswapV3Pool | null;
  isDiscovering: boolean;
  discoverError: string | null;
  baseToken: PoolSearchTokenInfo | null;
  quoteToken: PoolSearchTokenInfo | null;

  // Position Configuration (Step B) - consolidated capital, range, and SL/TP
  configurationTab: ConfigurationTab;  // Current sub-tab within position config step
  baseInputAmount: string;     // User input for base token (human-readable)
  quoteInputAmount: string;    // User input for quote token (human-readable)
  baseUsedMax: boolean;        // MAX button clicked for base
  quoteUsedMax: boolean;       // MAX button clicked for quote

  // Calculated allocation results
  allocatedBaseAmount: string;   // Calculated base amount (raw bigint as string)
  allocatedQuoteAmount: string;  // Calculated quote amount (raw bigint as string)
  totalQuoteValue: string;       // Total position value in quote (raw bigint as string)

  // Default price range (±20% from current price, used before range step)
  defaultTickLower: number;
  defaultTickUpper: number;

  // Range (Step C)
  tickLower: number;
  tickUpper: number;
  liquidity: string;

  // Automation (Step D)
  automationEnabled: boolean;
  stopLossEnabled: boolean;
  stopLossTick: number | null;
  takeProfitEnabled: boolean;
  takeProfitTick: number | null;

  // Conditional step flags
  needsSwap: boolean;
  needsAutowallet: boolean;

  // Transactions (Steps F-I)
  transactions: TransactionRecord[];
  positionId: string | null;
  nftId: string | null;

  // Validation
  stepValidation: Record<string, boolean>;

  // UI zoom settings (persist across steps)
  interactiveZoom: number;  // Font scale for interactive area (default: 1.0)
  summaryZoom: number;      // Font scale for summary section (default: 1.0)

  // Price Adjustment Step - original amounts saved as constraints (max values)
  originalAllocatedBaseAmount: string;   // Saved when leaving swap step
  originalAllocatedQuoteAmount: string;  // Saved when leaving swap step
  originalLiquidity: string;             // Saved when leaving swap step
  originalTotalQuoteValue: string;       // Saved when leaving swap step

  // Price Adjustment Step - recalculated amounts for current price
  adjustedBaseAmount: string;
  adjustedQuoteAmount: string;
  adjustedLiquidity: string;
  adjustedTotalQuoteValue: string;
  priceAdjustmentStatus: 'idle' | 'calculating' | 'ready' | 'error';
}

// ----- Actions -----

type WizardAction =
  | { type: 'GO_TO_STEP'; stepIndex: number }
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'SET_POOL_TAB'; tab: PoolSelectionTab }
  | { type: 'SELECT_POOL'; pool: PoolSearchResultItem }
  | { type: 'CLEAR_POOL' }
  | { type: 'SET_IS_DISCOVERING'; isDiscovering: boolean }
  | { type: 'SET_DISCOVERED_POOL'; pool: UniswapV3Pool }
  | { type: 'SET_DISCOVER_ERROR'; error: string }
  | { type: 'SET_CONFIGURATION_TAB'; tab: ConfigurationTab }
  | { type: 'SET_BASE_INPUT'; amount: string; usedMax: boolean }
  | { type: 'SET_QUOTE_INPUT'; amount: string; usedMax: boolean }
  | { type: 'SET_ALLOCATED_AMOUNTS'; base: string; quote: string; total: string }
  | { type: 'SET_DEFAULT_TICK_RANGE'; tickLower: number; tickUpper: number }
  | { type: 'SET_TICK_RANGE'; tickLower: number; tickUpper: number }
  | { type: 'SET_LIQUIDITY'; liquidity: string }
  | { type: 'SWAP_QUOTE_BASE' }
  | { type: 'SET_AUTOMATION_ENABLED'; enabled: boolean }
  | { type: 'SET_STOP_LOSS'; enabled: boolean; tick: number | null }
  | { type: 'SET_TAKE_PROFIT'; enabled: boolean; tick: number | null }
  | { type: 'SET_NEEDS_SWAP'; needsSwap: boolean }
  | { type: 'SET_NEEDS_AUTOWALLET'; needsAutowallet: boolean }
  | { type: 'ADD_TRANSACTION'; tx: TransactionRecord }
  | { type: 'UPDATE_TRANSACTION'; hash: string; status: TransactionRecord['status'] }
  | { type: 'SET_POSITION_CREATED'; positionId: string; nftId: string }
  | { type: 'SET_STEP_VALID'; stepId: string; valid: boolean }
  | { type: 'SET_INTERACTIVE_ZOOM'; zoom: number }
  | { type: 'SET_SUMMARY_ZOOM'; zoom: number }
  | { type: 'RESET' }
  | { type: 'HYDRATE_FROM_URL'; payload: HydrationPayload }
  // Price Adjustment Step actions
  | { type: 'SAVE_ORIGINAL_AMOUNTS' }
  | { type: 'SET_ADJUSTED_AMOUNTS'; base: string; quote: string; liquidity: string; totalValue: string }
  | { type: 'SET_PRICE_ADJUSTMENT_STATUS'; status: 'idle' | 'calculating' | 'ready' | 'error' }
  | { type: 'CLEAR_PRICE_ADJUSTMENT' };

// ----- Initial State -----

const initialState: CreatePositionWizardState = {
  currentStepIndex: 0,
  poolSelectionTab: 'search',
  selectedPool: null,
  discoveredPool: null,
  isDiscovering: false,
  discoverError: null,
  baseToken: null,
  quoteToken: null,
  configurationTab: 'capital',
  baseInputAmount: '',
  quoteInputAmount: '',
  baseUsedMax: false,
  quoteUsedMax: false,
  allocatedBaseAmount: '0',
  allocatedQuoteAmount: '0',
  totalQuoteValue: '0',
  defaultTickLower: 0,
  defaultTickUpper: 0,
  tickLower: 0,
  tickUpper: 0,
  liquidity: '0',
  automationEnabled: false,
  stopLossEnabled: false,
  stopLossTick: null,
  takeProfitEnabled: false,
  takeProfitTick: null,
  needsSwap: false,
  needsAutowallet: false,
  transactions: [],
  positionId: null,
  nftId: null,
  stepValidation: {},
  interactiveZoom: 1.0,
  summaryZoom: 1.0,
  // Price Adjustment Step
  originalAllocatedBaseAmount: '0',
  originalAllocatedQuoteAmount: '0',
  originalLiquidity: '0',
  originalTotalQuoteValue: '0',
  adjustedBaseAmount: '0',
  adjustedQuoteAmount: '0',
  adjustedLiquidity: '0',
  adjustedTotalQuoteValue: '0',
  priceAdjustmentStatus: 'idle',
};

// ----- Reducer -----

function wizardReducer(
  state: CreatePositionWizardState,
  action: WizardAction
): CreatePositionWizardState {
  switch (action.type) {
    case 'GO_TO_STEP':
      return { ...state, currentStepIndex: action.stepIndex };

    case 'GO_NEXT':
      return { ...state, currentStepIndex: state.currentStepIndex + 1 };

    case 'GO_BACK':
      return { ...state, currentStepIndex: Math.max(0, state.currentStepIndex - 1) };

    case 'SET_POOL_TAB':
      return { ...state, poolSelectionTab: action.tab };

    case 'SELECT_POOL':
      // Default: token0 is base, token1 is quote (user can swap later)
      return {
        ...state,
        selectedPool: action.pool,
        baseToken: action.pool.token0,
        quoteToken: action.pool.token1,
        // Reset tick range (will be set when current tick is fetched)
        tickLower: 0,
        tickUpper: 0,
        defaultTickLower: 0,
        defaultTickUpper: 0,
        // Reset SL/TP
        stopLossTick: null,
        takeProfitTick: null,
        stopLossEnabled: false,
        takeProfitEnabled: false,
        automationEnabled: false,
        // Reset capital allocation
        baseInputAmount: '',
        quoteInputAmount: '',
        baseUsedMax: false,
        quoteUsedMax: false,
        allocatedBaseAmount: '0',
        allocatedQuoteAmount: '0',
        totalQuoteValue: '0',
        liquidity: '0',
      };

    case 'CLEAR_POOL':
      return {
        ...state,
        selectedPool: null,
        discoveredPool: null,
        isDiscovering: false,
        discoverError: null,
        baseToken: null,
        quoteToken: null,
        // Reset tick range
        tickLower: 0,
        tickUpper: 0,
        defaultTickLower: 0,
        defaultTickUpper: 0,
        // Reset SL/TP
        stopLossTick: null,
        takeProfitTick: null,
        stopLossEnabled: false,
        takeProfitEnabled: false,
        automationEnabled: false,
        // Reset capital allocation
        baseInputAmount: '',
        quoteInputAmount: '',
        baseUsedMax: false,
        quoteUsedMax: false,
        allocatedBaseAmount: '0',
        allocatedQuoteAmount: '0',
        totalQuoteValue: '0',
        liquidity: '0',
      };

    case 'SET_IS_DISCOVERING':
      return {
        ...state,
        isDiscovering: action.isDiscovering,
        discoverError: action.isDiscovering ? null : state.discoverError,
      };

    case 'SET_DISCOVERED_POOL':
      return {
        ...state,
        discoveredPool: action.pool,
        isDiscovering: false,
        discoverError: null,
      };

    case 'SET_DISCOVER_ERROR':
      return {
        ...state,
        discoveredPool: null,
        isDiscovering: false,
        discoverError: action.error,
      };

    case 'SET_CONFIGURATION_TAB':
      return {
        ...state,
        configurationTab: action.tab,
      };

    case 'SET_BASE_INPUT':
      return {
        ...state,
        baseInputAmount: action.amount,
        baseUsedMax: action.usedMax,
      };

    case 'SET_QUOTE_INPUT':
      return {
        ...state,
        quoteInputAmount: action.amount,
        quoteUsedMax: action.usedMax,
      };

    case 'SET_ALLOCATED_AMOUNTS':
      return {
        ...state,
        allocatedBaseAmount: action.base,
        allocatedQuoteAmount: action.quote,
        totalQuoteValue: action.total,
      };

    case 'SET_DEFAULT_TICK_RANGE':
      return {
        ...state,
        defaultTickLower: action.tickLower,
        defaultTickUpper: action.tickUpper,
      };

    case 'SET_TICK_RANGE':
      return {
        ...state,
        tickLower: action.tickLower,
        tickUpper: action.tickUpper,
      };

    case 'SET_LIQUIDITY':
      return { ...state, liquidity: action.liquidity };

    case 'SWAP_QUOTE_BASE':
      return {
        ...state,
        baseToken: state.quoteToken,
        quoteToken: state.baseToken,
        // Swap input amounts to maintain user intent
        baseInputAmount: state.quoteInputAmount,
        quoteInputAmount: state.baseInputAmount,
        baseUsedMax: state.quoteUsedMax,
        quoteUsedMax: state.baseUsedMax,
        // Clear calculated amounts (will be recalculated)
        allocatedBaseAmount: '0',
        allocatedQuoteAmount: '0',
        totalQuoteValue: '0',
        // Reset tick range (will use defaults)
        tickLower: 0,
        tickUpper: 0,
        liquidity: '0',
      };

    case 'SET_AUTOMATION_ENABLED':
      return {
        ...state,
        automationEnabled: action.enabled,
        // Reset SL/TP when automation disabled
        stopLossEnabled: action.enabled ? state.stopLossEnabled : false,
        takeProfitEnabled: action.enabled ? state.takeProfitEnabled : false,
      };

    case 'SET_STOP_LOSS':
      return {
        ...state,
        stopLossEnabled: action.enabled,
        stopLossTick: action.tick,
        automationEnabled: action.enabled || state.takeProfitEnabled,
      };

    case 'SET_TAKE_PROFIT':
      return {
        ...state,
        takeProfitEnabled: action.enabled,
        takeProfitTick: action.tick,
        automationEnabled: state.stopLossEnabled || action.enabled,
      };

    case 'SET_NEEDS_SWAP':
      return { ...state, needsSwap: action.needsSwap };

    case 'SET_NEEDS_AUTOWALLET':
      return { ...state, needsAutowallet: action.needsAutowallet };

    case 'ADD_TRANSACTION':
      return {
        ...state,
        transactions: [...state.transactions, action.tx],
      };

    case 'UPDATE_TRANSACTION':
      return {
        ...state,
        transactions: state.transactions.map((tx) =>
          tx.hash === action.hash ? { ...tx, status: action.status } : tx
        ),
      };

    case 'SET_POSITION_CREATED':
      return {
        ...state,
        positionId: action.positionId,
        nftId: action.nftId,
      };

    case 'SET_STEP_VALID':
      return {
        ...state,
        stepValidation: {
          ...state.stepValidation,
          [action.stepId]: action.valid,
        },
      };

    case 'SET_INTERACTIVE_ZOOM':
      return { ...state, interactiveZoom: action.zoom };

    case 'SET_SUMMARY_ZOOM':
      return { ...state, summaryZoom: action.zoom };

    case 'RESET':
      return initialState;

    case 'HYDRATE_FROM_URL': {
      const { isToken0Quote } = action.payload;
      // Swap tokens if isToken0Quote differs from current assumption
      // selectPool already set baseToken=token0, quoteToken=token1
      // So we need to swap if isToken0Quote=true (meaning token0 should be quote)
      const needsSwap = isToken0Quote;

      return {
        ...state,
        // Token role swap if needed
        baseToken: needsSwap ? state.quoteToken : state.baseToken,
        quoteToken: needsSwap ? state.baseToken : state.quoteToken,
        // Capital inputs
        baseInputAmount: action.payload.baseInputAmount,
        quoteInputAmount: action.payload.quoteInputAmount,
        // Range (0 means use defaults from pool discovery)
        tickLower: action.payload.tickLower,
        tickUpper: action.payload.tickUpper,
        // SL/TP
        stopLossTick: action.payload.stopLossTick,
        takeProfitTick: action.payload.takeProfitTick,
        stopLossEnabled: action.payload.stopLossTick !== null,
        takeProfitEnabled: action.payload.takeProfitTick !== null,
        automationEnabled: action.payload.stopLossTick !== null || action.payload.takeProfitTick !== null,
        // Navigation
        currentStepIndex: action.payload.currentStepIndex,
        configurationTab: action.payload.configurationTab,
      };
    }

    // Price Adjustment Step actions
    case 'SAVE_ORIGINAL_AMOUNTS':
      return {
        ...state,
        originalAllocatedBaseAmount: state.allocatedBaseAmount,
        originalAllocatedQuoteAmount: state.allocatedQuoteAmount,
        originalLiquidity: state.liquidity,
        originalTotalQuoteValue: state.totalQuoteValue,
        // Clear any previous adjustments
        adjustedBaseAmount: '0',
        adjustedQuoteAmount: '0',
        adjustedLiquidity: '0',
        adjustedTotalQuoteValue: '0',
        priceAdjustmentStatus: 'idle',
      };

    case 'SET_ADJUSTED_AMOUNTS':
      return {
        ...state,
        adjustedBaseAmount: action.base,
        adjustedQuoteAmount: action.quote,
        adjustedLiquidity: action.liquidity,
        adjustedTotalQuoteValue: action.totalValue,
      };

    case 'SET_PRICE_ADJUSTMENT_STATUS':
      return {
        ...state,
        priceAdjustmentStatus: action.status,
      };

    case 'CLEAR_PRICE_ADJUSTMENT':
      return {
        ...state,
        adjustedBaseAmount: '0',
        adjustedQuoteAmount: '0',
        adjustedLiquidity: '0',
        adjustedTotalQuoteValue: '0',
        priceAdjustmentStatus: 'idle',
      };

    default:
      return state;
  }
}

// ----- Step Definitions -----

const BASE_STEPS: WizardStep[] = [
  { id: 'pool', label: 'Select Pool' },
  { id: 'configure', label: 'Configure Position' },
];

export function getVisibleSteps(state: CreatePositionWizardState): WizardStep[] {
  const steps = [...BASE_STEPS];

  // Always: Swap step (checks balances and allows swapping if needed)
  steps.push({ id: 'swap', label: 'Acquire Tokens' });

  // Conditional: Autowallet (must be before transactions if automation is enabled)
  if (state.automationEnabled && state.needsAutowallet) {
    steps.push({ id: 'autowallet', label: 'Setup Automation' });
  }

  // Always: Transactions step (handles approvals, mint, and SL/TP registration)
  steps.push({ id: 'transactions', label: 'Execute' });

  return steps;
}

// ----- Context -----

interface CreatePositionWizardContextValue {
  state: CreatePositionWizardState;
  steps: WizardStep[];
  currentStep: WizardStep;

  // URL hydration state
  isHydrating: boolean;

  // Navigation
  goToStep: (stepIndex: number) => void;
  goNext: () => void;
  goBack: () => void;
  canGoNext: boolean;
  canGoBack: boolean;

  // Pool selection
  setPoolTab: (tab: PoolSelectionTab) => void;
  selectPool: (pool: PoolSearchResultItem) => void;
  clearPool: () => void;
  setIsDiscovering: (isDiscovering: boolean) => void;
  setDiscoveredPool: (pool: UniswapV3Pool) => void;
  setDiscoverError: (error: string) => void;

  // Position Configuration
  setConfigurationTab: (tab: ConfigurationTab) => void;
  setBaseInput: (amount: string, usedMax: boolean) => void;
  setQuoteInput: (amount: string, usedMax: boolean) => void;
  setAllocatedAmounts: (base: string, quote: string, total: string) => void;
  setDefaultTickRange: (tickLower: number, tickUpper: number) => void;

  // Range
  setTickRange: (tickLower: number, tickUpper: number) => void;
  setLiquidity: (liquidity: string) => void;
  swapQuoteBase: () => void;

  // Automation
  setAutomationEnabled: (enabled: boolean) => void;
  setStopLoss: (enabled: boolean, tick: number | null) => void;
  setTakeProfit: (enabled: boolean, tick: number | null) => void;

  // Conditional flags
  setNeedsSwap: (needsSwap: boolean) => void;
  setNeedsAutowallet: (needsAutowallet: boolean) => void;

  // Transactions
  addTransaction: (tx: TransactionRecord) => void;
  updateTransaction: (hash: string, status: TransactionRecord['status']) => void;
  setPositionCreated: (positionId: string, nftId: string) => void;

  // Validation
  setStepValid: (stepId: string, valid: boolean) => void;
  isStepValid: (stepId: string) => boolean;

  // Zoom
  setInteractiveZoom: (zoom: number) => void;
  setSummaryZoom: (zoom: number) => void;

  // Price Adjustment Step
  saveOriginalAmounts: () => void;
  setAdjustedAmounts: (base: string, quote: string, liquidity: string, totalValue: string) => void;
  setPriceAdjustmentStatus: (status: 'idle' | 'calculating' | 'ready' | 'error') => void;
  clearPriceAdjustment: () => void;

  // Reset
  reset: () => void;
}

const CreatePositionWizardContext = createContext<CreatePositionWizardContextValue | undefined>(
  undefined
);

// ----- Provider -----

interface CreatePositionWizardProviderProps {
  children: ReactNode;
}

export function CreatePositionWizardProvider({ children }: CreatePositionWizardProviderProps) {
  // Persisted zoom settings from localStorage
  const [persistedInteractiveZoom, setPersistedInteractiveZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.interactive,
    ZOOM_DEFAULTS.interactive
  );
  const [persistedSummaryZoom, setPersistedSummaryZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.summary,
    ZOOM_DEFAULTS.summary
  );

  // Initialize reducer with persisted zoom values
  const [state, dispatch] = useReducer(wizardReducer, {
    ...initialState,
    interactiveZoom: persistedInteractiveZoom,
    summaryZoom: persistedSummaryZoom,
  });

  // Sync zoom changes to localStorage
  useEffect(() => {
    setPersistedInteractiveZoom(state.interactiveZoom);
  }, [state.interactiveZoom, setPersistedInteractiveZoom]);

  useEffect(() => {
    setPersistedSummaryZoom(state.summaryZoom);
  }, [state.summaryZoom, setPersistedSummaryZoom]);

  const steps = getVisibleSteps(state);
  const currentStep = steps[state.currentStepIndex] || steps[0];

  // Navigation
  const goToStep = useCallback((stepIndex: number) => {
    dispatch({ type: 'GO_TO_STEP', stepIndex });
  }, []);

  const goNext = useCallback(() => {
    dispatch({ type: 'GO_NEXT' });
  }, []);

  const goBack = useCallback(() => {
    dispatch({ type: 'GO_BACK' });
  }, []);

  const canGoNext = state.currentStepIndex < steps.length - 1;
  const canGoBack = state.currentStepIndex > 0;

  // Pool selection
  const setPoolTab = useCallback((tab: PoolSelectionTab) => {
    dispatch({ type: 'SET_POOL_TAB', tab });
  }, []);

  const selectPool = useCallback(
    (pool: PoolSearchResultItem) => {
      dispatch({ type: 'SELECT_POOL', pool });
    },
    []
  );

  const clearPool = useCallback(() => {
    dispatch({ type: 'CLEAR_POOL' });
  }, []);

  const setIsDiscovering = useCallback((isDiscovering: boolean) => {
    dispatch({ type: 'SET_IS_DISCOVERING', isDiscovering });
  }, []);

  const setDiscoveredPool = useCallback((pool: UniswapV3Pool) => {
    dispatch({ type: 'SET_DISCOVERED_POOL', pool });
  }, []);

  const setDiscoverError = useCallback((error: string) => {
    dispatch({ type: 'SET_DISCOVER_ERROR', error });
  }, []);

  // Position Configuration
  const setConfigurationTab = useCallback((tab: ConfigurationTab) => {
    dispatch({ type: 'SET_CONFIGURATION_TAB', tab });
  }, []);

  const setBaseInput = useCallback((amount: string, usedMax: boolean) => {
    dispatch({ type: 'SET_BASE_INPUT', amount, usedMax });
  }, []);

  const setQuoteInput = useCallback((amount: string, usedMax: boolean) => {
    dispatch({ type: 'SET_QUOTE_INPUT', amount, usedMax });
  }, []);

  const setAllocatedAmounts = useCallback((base: string, quote: string, total: string) => {
    dispatch({ type: 'SET_ALLOCATED_AMOUNTS', base, quote, total });
  }, []);

  const setDefaultTickRange = useCallback((tickLower: number, tickUpper: number) => {
    dispatch({ type: 'SET_DEFAULT_TICK_RANGE', tickLower, tickUpper });
  }, []);

  // Range
  const setTickRange = useCallback((tickLower: number, tickUpper: number) => {
    dispatch({ type: 'SET_TICK_RANGE', tickLower, tickUpper });
  }, []);

  const setLiquidity = useCallback((liquidity: string) => {
    dispatch({ type: 'SET_LIQUIDITY', liquidity });
  }, []);

  const swapQuoteBase = useCallback(() => {
    dispatch({ type: 'SWAP_QUOTE_BASE' });
  }, []);

  // Automation
  const setAutomationEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_AUTOMATION_ENABLED', enabled });
  }, []);

  const setStopLoss = useCallback((enabled: boolean, tick: number | null) => {
    dispatch({ type: 'SET_STOP_LOSS', enabled, tick });
  }, []);

  const setTakeProfit = useCallback((enabled: boolean, tick: number | null) => {
    dispatch({ type: 'SET_TAKE_PROFIT', enabled, tick });
  }, []);

  // Conditional flags
  const setNeedsSwap = useCallback((needsSwap: boolean) => {
    dispatch({ type: 'SET_NEEDS_SWAP', needsSwap });
  }, []);

  const setNeedsAutowallet = useCallback((needsAutowallet: boolean) => {
    dispatch({ type: 'SET_NEEDS_AUTOWALLET', needsAutowallet });
  }, []);

  // Transactions
  const addTransaction = useCallback((tx: TransactionRecord) => {
    dispatch({ type: 'ADD_TRANSACTION', tx });
  }, []);

  const updateTransaction = useCallback(
    (hash: string, status: TransactionRecord['status']) => {
      dispatch({ type: 'UPDATE_TRANSACTION', hash, status });
    },
    []
  );

  const setPositionCreated = useCallback((positionId: string, nftId: string) => {
    dispatch({ type: 'SET_POSITION_CREATED', positionId, nftId });
  }, []);

  // Validation
  const setStepValid = useCallback((stepId: string, valid: boolean) => {
    dispatch({ type: 'SET_STEP_VALID', stepId, valid });
  }, []);

  const isStepValid = useCallback(
    (stepId: string) => {
      return state.stepValidation[stepId] ?? false;
    },
    [state.stepValidation]
  );

  // Zoom
  const setInteractiveZoom = useCallback((zoom: number) => {
    dispatch({ type: 'SET_INTERACTIVE_ZOOM', zoom });
  }, []);

  const setSummaryZoom = useCallback((zoom: number) => {
    dispatch({ type: 'SET_SUMMARY_ZOOM', zoom });
  }, []);

  // Price Adjustment Step
  const saveOriginalAmounts = useCallback(() => {
    dispatch({ type: 'SAVE_ORIGINAL_AMOUNTS' });
  }, []);

  const setAdjustedAmounts = useCallback(
    (base: string, quote: string, liquidity: string, totalValue: string) => {
      dispatch({ type: 'SET_ADJUSTED_AMOUNTS', base, quote, liquidity, totalValue });
    },
    []
  );

  const setPriceAdjustmentStatus = useCallback(
    (status: 'idle' | 'calculating' | 'ready' | 'error') => {
      dispatch({ type: 'SET_PRICE_ADJUSTMENT_STATUS', status });
    },
    []
  );

  const clearPriceAdjustment = useCallback(() => {
    dispatch({ type: 'CLEAR_PRICE_ADJUSTMENT' });
  }, []);

  // Reset
  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // Hydration callback for URL state hook
  const handleHydrate = useCallback((payload: HydrationPayload) => {
    dispatch({ type: 'HYDRATE_FROM_URL', payload });
  }, []);

  // URL state sync - bidirectional sync between URL and wizard state
  const { isHydrating } = useWizardUrlState({
    state,
    selectPool,
    setDiscoveredPool,
    onHydrate: handleHydrate,
  });

  const value: CreatePositionWizardContextValue = {
    state,
    isHydrating,
    steps,
    currentStep,
    goToStep,
    goNext,
    goBack,
    canGoNext,
    canGoBack,
    setPoolTab,
    selectPool,
    clearPool,
    setIsDiscovering,
    setDiscoveredPool,
    setDiscoverError,
    setConfigurationTab,
    setBaseInput,
    setQuoteInput,
    setAllocatedAmounts,
    setDefaultTickRange,
    setTickRange,
    setLiquidity,
    swapQuoteBase,
    setAutomationEnabled,
    setStopLoss,
    setTakeProfit,
    setNeedsSwap,
    setNeedsAutowallet,
    addTransaction,
    updateTransaction,
    setPositionCreated,
    setStepValid,
    isStepValid,
    setInteractiveZoom,
    setSummaryZoom,
    saveOriginalAmounts,
    setAdjustedAmounts,
    setPriceAdjustmentStatus,
    clearPriceAdjustment,
    reset,
  };

  return (
    <CreatePositionWizardContext.Provider value={value}>
      {children}
    </CreatePositionWizardContext.Provider>
  );
}

// ----- Hook -----

export function useCreatePositionWizard() {
  const context = useContext(CreatePositionWizardContext);
  if (context === undefined) {
    throw new Error('useCreatePositionWizard must be used within a CreatePositionWizardProvider');
  }
  return context;
}
