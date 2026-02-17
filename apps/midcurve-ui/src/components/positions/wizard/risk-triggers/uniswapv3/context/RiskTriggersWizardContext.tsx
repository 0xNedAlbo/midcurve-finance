import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { ListPositionData, SerializedCloseOrder } from '@midcurve/api-shared';
import type { UniswapV3Pool } from '@midcurve/shared';
import { tickToPrice, priceToTick, getTickSpacing } from '@midcurve/shared';
import type { WizardStep } from '@/components/layout/wizard';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { ZOOM_STORAGE_KEYS, ZOOM_DEFAULTS } from '@/lib/zoom-settings';

// ----- Types -----

export type TriggerOperation = 'NOOP' | 'CREATE' | 'UPDATE' | 'CANCEL';

export interface TriggerState {
  enabled: boolean;
  priceBigint: bigint | null;
  triggerTick: number | null;
  closeOrderHash: string | null;
}

export interface SwapConfigState {
  enabled: boolean;
  slippageBps: number;
  swapToQuote: boolean; // true = swap to quote token, false = swap to base token
  exitSlippageBps: number; // slippage tolerance for decreaseLiquidity (basis points)
}

export interface RiskTriggersWizardState {
  currentStepIndex: number;

  // Position data
  position: ListPositionData | null;
  isLoadingPosition: boolean;
  positionError: string | null;
  discoveredPool: UniswapV3Pool | null;

  // Initial state (snapshot from existing orders, for change detection)
  initialStopLoss: TriggerState;
  initialTakeProfit: TriggerState;
  initialSlSwapConfig: SwapConfigState;
  initialTpSwapConfig: SwapConfigState;

  // Current state (user-editable)
  stopLoss: TriggerState;
  takeProfit: TriggerState;
  slSwapConfig: SwapConfigState;
  tpSwapConfig: SwapConfigState;

  // UI
  stepValidation: Record<string, boolean>;
  interactiveZoom: number;
  summaryZoom: number;
}

// ----- Actions -----

type WizardAction =
  | { type: 'GO_TO_STEP'; stepIndex: number }
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'SET_POSITION'; position: ListPositionData }
  | { type: 'SET_POSITION_LOADING'; isLoading: boolean }
  | { type: 'SET_POSITION_ERROR'; error: string }
  | { type: 'SET_DISCOVERED_POOL'; pool: UniswapV3Pool }
  | {
      type: 'INITIALIZE_FROM_ORDERS';
      sl: TriggerState;
      tp: TriggerState;
      slSwap: SwapConfigState;
      tpSwap: SwapConfigState;
    }
  | { type: 'SET_STOP_LOSS_PRICE'; priceBigint: bigint }
  | { type: 'CLEAR_STOP_LOSS' }
  | { type: 'SET_TAKE_PROFIT_PRICE'; priceBigint: bigint }
  | { type: 'CLEAR_TAKE_PROFIT' }
  | { type: 'SET_SL_SWAP_ENABLED'; enabled: boolean }
  | { type: 'SET_SL_SWAP_SLIPPAGE'; slippageBps: number }
  | { type: 'SET_TP_SWAP_ENABLED'; enabled: boolean }
  | { type: 'SET_TP_SWAP_SLIPPAGE'; slippageBps: number }
  | { type: 'SET_SL_SWAP_TO_QUOTE'; swapToQuote: boolean }
  | { type: 'SET_TP_SWAP_TO_QUOTE'; swapToQuote: boolean }
  | { type: 'SET_SL_EXIT_SLIPPAGE'; exitSlippageBps: number }
  | { type: 'SET_TP_EXIT_SLIPPAGE'; exitSlippageBps: number }
  | { type: 'SET_STEP_VALID'; stepId: string; valid: boolean }
  | { type: 'SET_INTERACTIVE_ZOOM'; zoom: number }
  | { type: 'SET_SUMMARY_ZOOM'; zoom: number }
  | { type: 'RESET' };

// ----- Steps -----

const RISK_TRIGGERS_STEPS: WizardStep[] = [
  { id: 'configure', label: 'Configure Triggers' },
  { id: 'transaction', label: 'Review & Execute' },
];

// ----- Initial State -----

const EMPTY_TRIGGER: TriggerState = {
  enabled: false,
  priceBigint: null,
  triggerTick: null,
  closeOrderHash: null,
};

const DEFAULT_SWAP_CONFIG: SwapConfigState = {
  enabled: true,
  slippageBps: 300,
  swapToQuote: true,
  exitSlippageBps: 50,
};

const initialState: RiskTriggersWizardState = {
  currentStepIndex: 0,
  position: null,
  isLoadingPosition: true,
  positionError: null,
  discoveredPool: null,
  initialStopLoss: { ...EMPTY_TRIGGER },
  initialTakeProfit: { ...EMPTY_TRIGGER },
  initialSlSwapConfig: { ...DEFAULT_SWAP_CONFIG },
  initialTpSwapConfig: { ...DEFAULT_SWAP_CONFIG },
  stopLoss: { ...EMPTY_TRIGGER },
  takeProfit: { ...EMPTY_TRIGGER },
  slSwapConfig: { ...DEFAULT_SWAP_CONFIG },
  tpSwapConfig: { ...DEFAULT_SWAP_CONFIG },
  stepValidation: {},
  interactiveZoom: 1.0,
  summaryZoom: 1.0,
};

// ----- Reducer -----

function wizardReducer(
  state: RiskTriggersWizardState,
  action: WizardAction
): RiskTriggersWizardState {
  switch (action.type) {
    case 'GO_TO_STEP':
      return { ...state, currentStepIndex: action.stepIndex };

    case 'GO_NEXT':
      return {
        ...state,
        currentStepIndex: Math.min(
          state.currentStepIndex + 1,
          RISK_TRIGGERS_STEPS.length - 1
        ),
      };

    case 'GO_BACK':
      return {
        ...state,
        currentStepIndex: Math.max(0, state.currentStepIndex - 1),
      };

    case 'SET_POSITION':
      return {
        ...state,
        position: action.position,
        isLoadingPosition: false,
        positionError: null,
      };

    case 'SET_POSITION_LOADING':
      return { ...state, isLoadingPosition: action.isLoading };

    case 'SET_POSITION_ERROR':
      return {
        ...state,
        isLoadingPosition: false,
        positionError: action.error,
      };

    case 'SET_DISCOVERED_POOL':
      return { ...state, discoveredPool: action.pool };

    case 'INITIALIZE_FROM_ORDERS':
      return {
        ...state,
        initialStopLoss: { ...action.sl },
        initialTakeProfit: { ...action.tp },
        initialSlSwapConfig: { ...action.slSwap },
        initialTpSwapConfig: { ...action.tpSwap },
        stopLoss: {
          enabled: action.sl.enabled,
          priceBigint: action.sl.priceBigint,
          triggerTick: action.sl.triggerTick,
          closeOrderHash: action.sl.closeOrderHash,
        },
        takeProfit: {
          enabled: action.tp.enabled,
          priceBigint: action.tp.priceBigint,
          triggerTick: action.tp.triggerTick,
          closeOrderHash: action.tp.closeOrderHash,
        },
        slSwapConfig: { ...action.slSwap },
        tpSwapConfig: { ...action.tpSwap },
      };

    case 'SET_STOP_LOSS_PRICE':
      return {
        ...state,
        stopLoss: {
          ...state.stopLoss,
          enabled: true,
          priceBigint: action.priceBigint,
        },
      };

    case 'CLEAR_STOP_LOSS':
      return {
        ...state,
        stopLoss: {
          ...state.stopLoss,
          enabled: false,
          priceBigint: null,
        },
      };

    case 'SET_TAKE_PROFIT_PRICE':
      return {
        ...state,
        takeProfit: {
          ...state.takeProfit,
          enabled: true,
          priceBigint: action.priceBigint,
        },
      };

    case 'CLEAR_TAKE_PROFIT':
      return {
        ...state,
        takeProfit: {
          ...state.takeProfit,
          enabled: false,
          priceBigint: null,
        },
      };

    case 'SET_SL_SWAP_ENABLED':
      return {
        ...state,
        slSwapConfig: { ...state.slSwapConfig, enabled: action.enabled },
      };

    case 'SET_SL_SWAP_SLIPPAGE':
      return {
        ...state,
        slSwapConfig: { ...state.slSwapConfig, slippageBps: action.slippageBps },
      };

    case 'SET_TP_SWAP_ENABLED':
      return {
        ...state,
        tpSwapConfig: { ...state.tpSwapConfig, enabled: action.enabled },
      };

    case 'SET_TP_SWAP_SLIPPAGE':
      return {
        ...state,
        tpSwapConfig: { ...state.tpSwapConfig, slippageBps: action.slippageBps },
      };

    case 'SET_SL_SWAP_TO_QUOTE':
      return {
        ...state,
        slSwapConfig: { ...state.slSwapConfig, swapToQuote: action.swapToQuote },
      };

    case 'SET_TP_SWAP_TO_QUOTE':
      return {
        ...state,
        tpSwapConfig: { ...state.tpSwapConfig, swapToQuote: action.swapToQuote },
      };

    case 'SET_SL_EXIT_SLIPPAGE':
      return {
        ...state,
        slSwapConfig: { ...state.slSwapConfig, exitSlippageBps: action.exitSlippageBps },
      };

    case 'SET_TP_EXIT_SLIPPAGE':
      return {
        ...state,
        tpSwapConfig: { ...state.tpSwapConfig, exitSlippageBps: action.exitSlippageBps },
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

    default:
      return state;
  }
}

// ----- Utilities -----

/**
 * Compare two trigger ticks accounting for null values.
 * Returns true if they're effectively the same.
 */
function ticksEqual(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a === b;
}

function computeOperation(
  initial: TriggerState,
  current: { enabled: boolean; priceBigint: bigint | null },
  currentTick: number | null
): TriggerOperation {
  if (!initial.enabled && !current.enabled) return 'NOOP';
  if (!initial.enabled && current.enabled) return 'CREATE';
  if (initial.enabled && !current.enabled) return 'CANCEL';
  // Both enabled — compare ticks
  if (ticksEqual(initial.triggerTick, currentTick)) return 'NOOP';
  return 'UPDATE';
}

/**
 * Convert existing close orders to wizard trigger state.
 */
export function convertOrdersToTriggerState(
  orders: SerializedCloseOrder[],
  baseTokenAddress: string,
  quoteTokenAddress: string,
  baseTokenDecimals: number,
  isToken0Quote: boolean,
): {
  sl: TriggerState;
  tp: TriggerState;
  slSwap: SwapConfigState;
  tpSwap: SwapConfigState;
} {
  const activeStatuses = ['active', 'pending', 'registering'];

  // config.triggerMode stores the on-chain value. When isToken0Quote, tick direction
  // is inverse to user price direction, so the on-chain triggerMode is flipped:
  //   isToken0Quote: SL = on-chain UPPER, TP = on-chain LOWER
  //  !isToken0Quote: SL = on-chain LOWER, TP = on-chain UPPER
  const slConfigTriggerMode = isToken0Quote ? 'UPPER' : 'LOWER';
  const tpConfigTriggerMode = isToken0Quote ? 'LOWER' : 'UPPER';

  const slOrder = orders.find((o) => {
    return (
      o.triggerMode === slConfigTriggerMode &&
      activeStatuses.includes(o.status)
    );
  });

  const tpOrder = orders.find((o) => {
    return (
      o.triggerMode === tpConfigTriggerMode &&
      activeStatuses.includes(o.status)
    );
  });

  const extractTriggerState = (
    order: SerializedCloseOrder | undefined,
  ): TriggerState => {
    if (!order || !order.closeOrderHash) {
      return { ...EMPTY_TRIGGER };
    }

    // Extract tick from closeOrderHash format: "sl@{tick}" or "tp@{tick}"
    const parts = order.closeOrderHash.split('@');
    const tick = parts.length === 2 ? parseInt(parts[1], 10) : null;

    // Convert tick to price
    let priceBigint: bigint | null = null;
    if (tick !== null && !isNaN(tick)) {
      try {
        priceBigint = tickToPrice(
          tick,
          baseTokenAddress,
          quoteTokenAddress,
          baseTokenDecimals
        );
      } catch {
        // Fallback: leave priceBigint null
      }
    }

    return {
      enabled: true,
      priceBigint,
      triggerTick: tick,
      closeOrderHash: order.closeOrderHash,
    };
  };

  const sl = extractTriggerState(slOrder);
  const tp = extractTriggerState(tpOrder);

  // Extract swap config per order
  const extractSwapConfig = (order: SerializedCloseOrder | undefined): SwapConfigState => {
    if (!order) return { ...DEFAULT_SWAP_CONFIG };
    const exitSlippageBps = order.slippageBps ?? DEFAULT_SWAP_CONFIG.exitSlippageBps;
    if (order.swapDirection !== null) {
      const toQuoteDirection = computeSwapToQuoteDirection(isToken0Quote);
      return {
        enabled: true,
        slippageBps: order.swapSlippageBps ?? DEFAULT_SWAP_CONFIG.slippageBps,
        swapToQuote: order.swapDirection === toQuoteDirection,
        exitSlippageBps,
      };
    }
    return { enabled: false, slippageBps: DEFAULT_SWAP_CONFIG.slippageBps, swapToQuote: true, exitSlippageBps };
  };

  return { sl, tp, slSwap: extractSwapConfig(slOrder), tpSwap: extractSwapConfig(tpOrder) };
}

/**
 * Compute the swap direction for "swap to quote" mode.
 */
export function computeSwapToQuoteDirection(
  isToken0Quote: boolean
): 'TOKEN0_TO_1' | 'TOKEN1_TO_0' {
  return isToken0Quote ? 'TOKEN1_TO_0' : 'TOKEN0_TO_1';
}

/**
 * Compute the actual SwapDirection based on user's semantic choice and pool token ordering.
 */
export function computeSwapDirection(
  swapToQuote: boolean,
  isToken0Quote: boolean
): 'TOKEN0_TO_1' | 'TOKEN1_TO_0' {
  return swapToQuote
    ? computeSwapToQuoteDirection(isToken0Quote)
    : computeSwapToQuoteDirection(!isToken0Quote);
}

// ----- Context -----

interface RiskTriggersWizardContextValue {
  state: RiskTriggersWizardState;
  steps: WizardStep[];
  currentStep: WizardStep;

  // Navigation
  goNext: () => void;
  goBack: () => void;
  goToStep: (stepIndex: number) => void;
  canGoNext: boolean;
  canGoBack: boolean;

  // Data loading
  setPosition: (position: ListPositionData) => void;
  setPositionLoading: (isLoading: boolean) => void;
  setPositionError: (error: string) => void;
  setDiscoveredPool: (pool: UniswapV3Pool) => void;
  initializeFromOrders: (
    orders: SerializedCloseOrder[],
    baseTokenAddress: string,
    quoteTokenAddress: string,
    baseTokenDecimals: number,
    isToken0Quote: boolean,
  ) => void;

  // Trigger editing
  setStopLossPrice: (priceBigint: bigint) => void;
  clearStopLoss: () => void;
  setTakeProfitPrice: (priceBigint: bigint) => void;
  clearTakeProfit: () => void;

  // Swap config (per-order)
  setSlSwapEnabled: (enabled: boolean) => void;
  setSlSwapSlippage: (slippageBps: number) => void;
  setSlSwapToQuote: (swapToQuote: boolean) => void;
  setSlExitSlippage: (exitSlippageBps: number) => void;
  setTpSwapEnabled: (enabled: boolean) => void;
  setTpSwapSlippage: (slippageBps: number) => void;
  setTpSwapToQuote: (swapToQuote: boolean) => void;
  setTpExitSlippage: (exitSlippageBps: number) => void;

  // UI
  setStepValid: (stepId: string, valid: boolean) => void;
  isStepValid: (stepId: string) => boolean;
  setInteractiveZoom: (zoom: number) => void;
  setSummaryZoom: (zoom: number) => void;

  // Computed
  slOperation: TriggerOperation;
  tpOperation: TriggerOperation;
  slSwapChanged: boolean;
  tpSwapChanged: boolean;
  hasChanges: boolean;
}

const RiskTriggersWizardContext =
  createContext<RiskTriggersWizardContextValue | null>(null);

// ----- Provider -----

export function RiskTriggersWizardProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [storedInteractiveZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.interactive,
    ZOOM_DEFAULTS.interactive
  );
  const [storedSummaryZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.summary,
    ZOOM_DEFAULTS.summary
  );

  const [state, dispatch] = useReducer(wizardReducer, {
    ...initialState,
    interactiveZoom: storedInteractiveZoom,
    summaryZoom: storedSummaryZoom,
  });

  const [, setStoredInteractiveZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.interactive,
    ZOOM_DEFAULTS.interactive
  );
  const [, setStoredSummaryZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.summary,
    ZOOM_DEFAULTS.summary
  );

  // Navigation
  const goNext = useCallback(() => dispatch({ type: 'GO_NEXT' }), []);
  const goBack = useCallback(() => dispatch({ type: 'GO_BACK' }), []);
  const goToStep = useCallback(
    (stepIndex: number) => dispatch({ type: 'GO_TO_STEP', stepIndex }),
    []
  );

  // Data loading
  const setPosition = useCallback(
    (position: ListPositionData) =>
      dispatch({ type: 'SET_POSITION', position }),
    []
  );
  const setPositionLoading = useCallback(
    (isLoading: boolean) =>
      dispatch({ type: 'SET_POSITION_LOADING', isLoading }),
    []
  );
  const setPositionError = useCallback(
    (error: string) => dispatch({ type: 'SET_POSITION_ERROR', error }),
    []
  );
  const setDiscoveredPool = useCallback(
    (pool: UniswapV3Pool) => dispatch({ type: 'SET_DISCOVERED_POOL', pool }),
    []
  );
  const initializeFromOrders = useCallback(
    (
      orders: SerializedCloseOrder[],
      baseTokenAddress: string,
      quoteTokenAddress: string,
      baseTokenDecimals: number,
      isToken0Quote: boolean,
    ) => {
      const { sl, tp, slSwap, tpSwap } = convertOrdersToTriggerState(
        orders,
        baseTokenAddress,
        quoteTokenAddress,
        baseTokenDecimals,
        isToken0Quote,
      );
      dispatch({ type: 'INITIALIZE_FROM_ORDERS', sl, tp, slSwap, tpSwap });
    },
    []
  );

  // Trigger editing
  const setStopLossPrice = useCallback(
    (priceBigint: bigint) =>
      dispatch({ type: 'SET_STOP_LOSS_PRICE', priceBigint }),
    []
  );
  const clearStopLoss = useCallback(
    () => dispatch({ type: 'CLEAR_STOP_LOSS' }),
    []
  );
  const setTakeProfitPrice = useCallback(
    (priceBigint: bigint) =>
      dispatch({ type: 'SET_TAKE_PROFIT_PRICE', priceBigint }),
    []
  );
  const clearTakeProfit = useCallback(
    () => dispatch({ type: 'CLEAR_TAKE_PROFIT' }),
    []
  );

  // Swap config (per-order)
  const setSlSwapEnabled = useCallback(
    (enabled: boolean) => dispatch({ type: 'SET_SL_SWAP_ENABLED', enabled }),
    []
  );
  const setSlSwapSlippage = useCallback(
    (slippageBps: number) =>
      dispatch({ type: 'SET_SL_SWAP_SLIPPAGE', slippageBps }),
    []
  );
  const setTpSwapEnabled = useCallback(
    (enabled: boolean) => dispatch({ type: 'SET_TP_SWAP_ENABLED', enabled }),
    []
  );
  const setTpSwapSlippage = useCallback(
    (slippageBps: number) =>
      dispatch({ type: 'SET_TP_SWAP_SLIPPAGE', slippageBps }),
    []
  );
  const setSlSwapToQuote = useCallback(
    (swapToQuote: boolean) =>
      dispatch({ type: 'SET_SL_SWAP_TO_QUOTE', swapToQuote }),
    []
  );
  const setTpSwapToQuote = useCallback(
    (swapToQuote: boolean) =>
      dispatch({ type: 'SET_TP_SWAP_TO_QUOTE', swapToQuote }),
    []
  );
  const setSlExitSlippage = useCallback(
    (exitSlippageBps: number) =>
      dispatch({ type: 'SET_SL_EXIT_SLIPPAGE', exitSlippageBps }),
    []
  );
  const setTpExitSlippage = useCallback(
    (exitSlippageBps: number) =>
      dispatch({ type: 'SET_TP_EXIT_SLIPPAGE', exitSlippageBps }),
    []
  );

  // UI
  const setStepValid = useCallback(
    (stepId: string, valid: boolean) =>
      dispatch({ type: 'SET_STEP_VALID', stepId, valid }),
    []
  );
  const isStepValid = useCallback(
    (stepId: string) => state.stepValidation[stepId] ?? false,
    [state.stepValidation]
  );
  const setInteractiveZoom = useCallback(
    (zoom: number) => {
      dispatch({ type: 'SET_INTERACTIVE_ZOOM', zoom });
      setStoredInteractiveZoom(zoom);
    },
    [setStoredInteractiveZoom]
  );
  const setSummaryZoom = useCallback(
    (zoom: number) => {
      dispatch({ type: 'SET_SUMMARY_ZOOM', zoom });
      setStoredSummaryZoom(zoom);
    },
    [setStoredSummaryZoom]
  );

  // Computed: need to derive current ticks from priceBigint for comparison
  // We compute ticks on-the-fly using the pool data when available
  // Helper to extract token addresses from position
  const tokenAddresses = useMemo(() => {
    if (!state.position) return null;
    const pos = state.position;
    const baseToken = pos.isToken0Quote ? pos.pool.token1 : pos.pool.token0;
    const quoteToken = pos.isToken0Quote ? pos.pool.token0 : pos.pool.token1;
    return {
      baseAddress: (baseToken.config as { address: string }).address,
      quoteAddress: (quoteToken.config as { address: string }).address,
      baseDecimals: baseToken.decimals,
    };
  }, [state.position]);

  const currentSlTick = useMemo(() => {
    if (!state.stopLoss.enabled || !state.stopLoss.priceBigint || !state.discoveredPool || !tokenAddresses) {
      return null;
    }
    try {
      const tickSpacing = getTickSpacing(state.discoveredPool.feeBps);
      return priceToTick(
        state.stopLoss.priceBigint,
        tickSpacing,
        tokenAddresses.baseAddress,
        tokenAddresses.quoteAddress,
        tokenAddresses.baseDecimals
      );
    } catch {
      return null;
    }
  }, [state.stopLoss.enabled, state.stopLoss.priceBigint, state.discoveredPool, tokenAddresses]);

  const currentTpTick = useMemo(() => {
    if (!state.takeProfit.enabled || !state.takeProfit.priceBigint || !state.discoveredPool || !tokenAddresses) {
      return null;
    }
    try {
      const tickSpacing = getTickSpacing(state.discoveredPool.feeBps);
      return priceToTick(
        state.takeProfit.priceBigint,
        tickSpacing,
        tokenAddresses.baseAddress,
        tokenAddresses.quoteAddress,
        tokenAddresses.baseDecimals
      );
    } catch {
      return null;
    }
  }, [state.takeProfit.enabled, state.takeProfit.priceBigint, state.discoveredPool, tokenAddresses]);

  const slOperation = useMemo(
    () => computeOperation(state.initialStopLoss, state.stopLoss, currentSlTick),
    [state.initialStopLoss, state.stopLoss, currentSlTick]
  );

  const tpOperation = useMemo(
    () => computeOperation(state.initialTakeProfit, state.takeProfit, currentTpTick),
    [state.initialTakeProfit, state.takeProfit, currentTpTick]
  );

  const slSwapChanged = useMemo(
    () =>
      state.initialSlSwapConfig.enabled !== state.slSwapConfig.enabled ||
      state.initialSlSwapConfig.slippageBps !== state.slSwapConfig.slippageBps ||
      state.initialSlSwapConfig.swapToQuote !== state.slSwapConfig.swapToQuote ||
      state.initialSlSwapConfig.exitSlippageBps !== state.slSwapConfig.exitSlippageBps,
    [state.initialSlSwapConfig, state.slSwapConfig]
  );

  const tpSwapChanged = useMemo(
    () =>
      state.initialTpSwapConfig.enabled !== state.tpSwapConfig.enabled ||
      state.initialTpSwapConfig.slippageBps !== state.tpSwapConfig.slippageBps ||
      state.initialTpSwapConfig.swapToQuote !== state.tpSwapConfig.swapToQuote ||
      state.initialTpSwapConfig.exitSlippageBps !== state.tpSwapConfig.exitSlippageBps,
    [state.initialTpSwapConfig, state.tpSwapConfig]
  );

  const hasChanges = useMemo(
    () => slOperation !== 'NOOP' || tpOperation !== 'NOOP' || slSwapChanged || tpSwapChanged,
    [slOperation, tpOperation, slSwapChanged, tpSwapChanged]
  );

  const currentStep =
    RISK_TRIGGERS_STEPS[state.currentStepIndex] ?? RISK_TRIGGERS_STEPS[0];
  const canGoNext = state.currentStepIndex < RISK_TRIGGERS_STEPS.length - 1;
  const canGoBack = state.currentStepIndex > 0;

  const value: RiskTriggersWizardContextValue = {
    state,
    steps: RISK_TRIGGERS_STEPS,
    currentStep,
    goNext,
    goBack,
    goToStep,
    canGoNext,
    canGoBack,
    setPosition,
    setPositionLoading,
    setPositionError,
    setDiscoveredPool,
    initializeFromOrders,
    setStopLossPrice,
    clearStopLoss,
    setTakeProfitPrice,
    clearTakeProfit,
    setSlSwapEnabled,
    setSlSwapSlippage,
    setSlSwapToQuote,
    setSlExitSlippage,
    setTpSwapEnabled,
    setTpSwapSlippage,
    setTpSwapToQuote,
    setTpExitSlippage,
    setStepValid,
    isStepValid,
    setInteractiveZoom,
    setSummaryZoom,
    slOperation,
    tpOperation,
    slSwapChanged,
    tpSwapChanged,
    hasChanges,
  };

  return (
    <RiskTriggersWizardContext.Provider value={value}>
      {children}
    </RiskTriggersWizardContext.Provider>
  );
}

// ----- Hook -----

export function useRiskTriggersWizard() {
  const context = useContext(RiskTriggersWizardContext);
  if (!context) {
    throw new Error(
      'useRiskTriggersWizard must be used within RiskTriggersWizardProvider'
    );
  }
  return context;
}
