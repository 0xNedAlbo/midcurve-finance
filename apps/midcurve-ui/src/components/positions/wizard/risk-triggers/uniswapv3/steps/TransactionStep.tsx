import { useCallback, useMemo, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import {
  Circle,
  Check,
  Loader2,
  AlertCircle,
  ExternalLink,
  Copy,
  ChevronDown,
  ChevronRight,
  PlusCircle,
  MinusCircle,
} from 'lucide-react';
import type { Address } from 'viem';
import {
  formatCompactValue,
  priceToTick,
  getTickSpacing,
} from '@midcurve/shared';
import {
  useRiskTriggersWizard,
  computeSwapDirection,
} from '../context/RiskTriggersWizardContext';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { useOperatorApproval } from '@/hooks/automation/useOperatorApproval';
import { useMulticallPositionCloser, type PositionCloserCall } from '@/hooks/automation/useMulticallPositionCloser';
import { useSharedContract } from '@/hooks/automation/useSharedContract';
import { useAutowallet } from '@/hooks/automation/useAutowallet';
import { getChainSlugByChainId } from '@/config/chains';
import { buildTxUrl, truncateTxHash } from '@/lib/explorer-utils';

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

// ----- Sub-operation descriptor (for display inside multicall row) -----
interface SubOperation {
  id: string;
  label: string;
}

export function TransactionStep() {
  const {
    state,
    goBack,
    slOperation,
    tpOperation,
    slSwapChanged,
    tpSwapChanged,
    setSummaryZoom,
  } = useRiskTriggersWizard();

  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo || '/dashboard';

  const { address: connectedAddress, isConnected } = useAccount();
  const walletChainId = useChainId();

  const position = state.position;

  // Extract chain and NFT info
  const chainId = useMemo(() => {
    if (!position) return 0;
    return (position.config as { chainId: number }).chainId;
  }, [position]);

  const chainSlug = getChainSlugByChainId(chainId);
  const isWrongNetwork = isConnected && walletChainId !== chainId;

  const nftId = useMemo(() => {
    if (!position) return '';
    return (position.config as { nftId: number }).nftId.toString();
  }, [position]);

  const poolAddress = useMemo(() => {
    if (!position) return '' as Address;
    return (position.config as { poolAddress: string })
      .poolAddress as Address;
  }, [position]);

  // Token info
  const tokenInfo = useMemo(() => {
    if (!position) return null;
    const baseToken = position.isToken0Quote
      ? position.pool.token1
      : position.pool.token0;
    const quoteToken = position.isToken0Quote
      ? position.pool.token0
      : position.pool.token1;
    return {
      baseAddress: (baseToken.config as { address: string }).address,
      quoteAddress: (quoteToken.config as { address: string }).address,
      baseDecimals: baseToken.decimals,
      quoteDecimals: quoteToken.decimals,
      quoteSymbol: quoteToken.symbol,
      isToken0Quote: position.isToken0Quote,
    };
  }, [position]);

  // Hooks
  const { data: sharedContract } = useSharedContract(chainId, nftId);
  const contractAddress = sharedContract?.contractAddress as
    | Address
    | undefined;
  const { data: autowalletData } = useAutowallet();

  const operatorApproval = useOperatorApproval(chainId, contractAddress);
  const multicall = useMulticallPositionCloser(chainId, nftId);

  // ----- Compute trigger ticks -----
  const currentSlTick = useMemo(() => {
    if (
      !state.stopLoss.enabled ||
      !state.stopLoss.priceBigint ||
      !state.discoveredPool ||
      !tokenInfo
    )
      return null;
    try {
      const tickSpacing = getTickSpacing(state.discoveredPool.feeBps);
      return priceToTick(
        state.stopLoss.priceBigint,
        tickSpacing,
        tokenInfo.baseAddress,
        tokenInfo.quoteAddress,
        tokenInfo.baseDecimals
      );
    } catch {
      return null;
    }
  }, [state.stopLoss, state.discoveredPool, tokenInfo]);

  const currentTpTick = useMemo(() => {
    if (
      !state.takeProfit.enabled ||
      !state.takeProfit.priceBigint ||
      !state.discoveredPool ||
      !tokenInfo
    )
      return null;
    try {
      const tickSpacing = getTickSpacing(state.discoveredPool.feeBps);
      return priceToTick(
        state.takeProfit.priceBigint,
        tickSpacing,
        tokenInfo.baseAddress,
        tokenInfo.quoteAddress,
        tokenInfo.baseDecimals
      );
    } catch {
      return null;
    }
  }, [state.takeProfit, state.discoveredPool, tokenInfo]);

  // ----- Determine if NFPM approval is needed -----
  const needsApproval = useMemo(() => {
    const needsCreate = slOperation === 'CREATE' || tpOperation === 'CREATE';
    return needsCreate && !operatorApproval.isApproved;
  }, [slOperation, tpOperation, operatorApproval.isApproved]);

  // ----- Build sub-operation labels (for display) -----
  const subOperations = useMemo((): SubOperation[] => {
    const ops: SubOperation[] = [];
    const quoteDecimals = tokenInfo?.quoteDecimals ?? 18;
    const quoteSymbol = tokenInfo?.quoteSymbol ?? '';

    // Cancels first
    if (slOperation === 'CANCEL') {
      ops.push({ id: 'cancel_sl', label: 'Cancel Stop Loss' });
    }
    if (tpOperation === 'CANCEL') {
      ops.push({ id: 'cancel_tp', label: 'Cancel Take Profit' });
    }

    // Updates
    if (slOperation === 'UPDATE') {
      ops.push({ id: 'update_sl_tick', label: 'Update Stop Loss trigger price' });
    }
    if (tpOperation === 'UPDATE') {
      ops.push({ id: 'update_tp_tick', label: 'Update Take Profit trigger price' });
    }

    // Swap updates
    if (
      slSwapChanged &&
      state.stopLoss.enabled &&
      slOperation !== 'CREATE' &&
      slOperation !== 'CANCEL'
    ) {
      ops.push({ id: 'update_sl_swap', label: 'Update Stop Loss swap config' });
    }
    if (
      tpSwapChanged &&
      state.takeProfit.enabled &&
      tpOperation !== 'CREATE' &&
      tpOperation !== 'CANCEL'
    ) {
      ops.push({ id: 'update_tp_swap', label: 'Update Take Profit swap config' });
    }

    // Ghost-order cancels (failed orders still active on-chain)
    if (slOperation === 'CREATE' && state.initialStopLoss.hasFailedOnChainOrder) {
      ops.push({ id: 'cancel_ghost_sl', label: 'Cancel failed Stop Loss (on-chain cleanup)' });
    }
    if (tpOperation === 'CREATE' && state.initialTakeProfit.hasFailedOnChainOrder) {
      ops.push({ id: 'cancel_ghost_tp', label: 'Cancel failed Take Profit (on-chain cleanup)' });
    }

    // Creates
    if (slOperation === 'CREATE') {
      const priceLabel = state.stopLoss.priceBigint
        ? ` at ${formatCompactValue(state.stopLoss.priceBigint, quoteDecimals)} ${quoteSymbol}`
        : '';
      ops.push({ id: 'create_sl', label: `Register Stop Loss${priceLabel}` });
    }
    if (tpOperation === 'CREATE') {
      const priceLabel = state.takeProfit.priceBigint
        ? ` at ${formatCompactValue(state.takeProfit.priceBigint, quoteDecimals)} ${quoteSymbol}`
        : '';
      ops.push({ id: 'create_tp', label: `Register Take Profit${priceLabel}` });
    }

    return ops;
  }, [
    slOperation, tpOperation, slSwapChanged, tpSwapChanged,
    state.stopLoss.enabled, state.stopLoss.priceBigint,
    state.takeProfit.enabled, state.takeProfit.priceBigint,
    state.initialStopLoss.hasFailedOnChainOrder,
    state.initialTakeProfit.hasFailedOnChainOrder,
    tokenInfo,
  ]);

  // ----- Build multicall calldata from sub-operations -----
  const buildMulticallCalls = useCallback((): PositionCloserCall[] | null => {
    if (!tokenInfo) return null;

    const nftIdBigInt = BigInt(nftId);
    const autowalletAddress = autowalletData?.address as Address | undefined;
    const calls: PositionCloserCall[] = [];

    // Map OrderType to TriggerMode contract value
    const triggerModeMap = { STOP_LOSS: 0, TAKE_PROFIT: 1 } as const;
    const swapDirectionMap = { NONE: 0, TOKEN0_TO_1: 1, TOKEN1_TO_0: 2 } as const;

    // When isToken0Quote, tick direction is inverse to user price direction:
    //   SL (user price falls) → tick RISES → contract needs UPPER (>=)
    //   TP (user price rises) → tick FALLS → contract needs LOWER (<=)
    const slContractMode = tokenInfo.isToken0Quote
      ? triggerModeMap.TAKE_PROFIT   // UPPER — tick rises when price falls
      : triggerModeMap.STOP_LOSS;    // LOWER — tick falls when price falls
    const tpContractMode = tokenInfo.isToken0Quote
      ? triggerModeMap.STOP_LOSS     // LOWER — tick falls when price rises
      : triggerModeMap.TAKE_PROFIT;  // UPPER — tick rises when price rises

    // Cancels
    if (slOperation === 'CANCEL') {
      calls.push({
        functionName: 'cancelOrder',
        args: [nftIdBigInt, slContractMode],
      });
    }
    if (tpOperation === 'CANCEL') {
      calls.push({
        functionName: 'cancelOrder',
        args: [nftIdBigInt, tpContractMode],
      });
    }

    // Ghost-order cancels: failed orders still active on-chain need cancel before re-register
    if (slOperation === 'CREATE' && state.initialStopLoss.hasFailedOnChainOrder) {
      calls.push({
        functionName: 'cancelOrder',
        args: [nftIdBigInt, slContractMode],
      });
    }
    if (tpOperation === 'CREATE' && state.initialTakeProfit.hasFailedOnChainOrder) {
      calls.push({
        functionName: 'cancelOrder',
        args: [nftIdBigInt, tpContractMode],
      });
    }

    // Tick updates
    if (slOperation === 'UPDATE' && currentSlTick !== null) {
      calls.push({
        functionName: 'setTriggerTick',
        args: [nftIdBigInt, slContractMode, currentSlTick],
      });
    }
    if (tpOperation === 'UPDATE' && currentTpTick !== null) {
      calls.push({
        functionName: 'setTriggerTick',
        args: [nftIdBigInt, tpContractMode, currentTpTick],
      });
    }

    // Swap intent updates
    if (
      slSwapChanged &&
      state.stopLoss.enabled &&
      slOperation !== 'CREATE' &&
      slOperation !== 'CANCEL'
    ) {
      const swapCfg = state.slSwapConfig;
      const direction = swapCfg.enabled
        ? computeSwapDirection(swapCfg.swapToQuote, tokenInfo.isToken0Quote)
        : ('NONE' as const);
      const dirValue = swapDirectionMap[direction];
      calls.push({
        functionName: 'setSwapIntent',
        args: [
          nftIdBigInt,
          slContractMode,
          dirValue,
          swapCfg.enabled ? swapCfg.slippageBps : 0,
        ],
      });
    }
    if (
      tpSwapChanged &&
      state.takeProfit.enabled &&
      tpOperation !== 'CREATE' &&
      tpOperation !== 'CANCEL'
    ) {
      const swapCfg = state.tpSwapConfig;
      const direction = swapCfg.enabled
        ? computeSwapDirection(swapCfg.swapToQuote, tokenInfo.isToken0Quote)
        : ('NONE' as const);
      const dirValue = swapDirectionMap[direction];
      calls.push({
        functionName: 'setSwapIntent',
        args: [
          nftIdBigInt,
          tpContractMode,
          dirValue,
          swapCfg.enabled ? swapCfg.slippageBps : 0,
        ],
      });
    }

    // Creates
    if (slOperation === 'CREATE' && currentSlTick !== null && autowalletAddress) {
      const swapCfg = state.slSwapConfig;
      const swapDirection = swapCfg.enabled
        ? swapDirectionMap[computeSwapDirection(swapCfg.swapToQuote, tokenInfo.isToken0Quote)]
        : 0;
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);

      calls.push({
        functionName: 'registerOrder',
        args: [
          {
            nftId: nftIdBigInt,
            pool: poolAddress,
            triggerMode: slContractMode,
            triggerTick: currentSlTick,
            payout: connectedAddress as Address,
            operator: autowalletAddress,
            validUntil,
            slippageBps: swapCfg.exitSlippageBps,
            swapDirection,
            swapSlippageBps: swapCfg.enabled ? swapCfg.slippageBps : 0,
          },
        ],
      });
    }
    if (tpOperation === 'CREATE' && currentTpTick !== null && autowalletAddress) {
      const swapCfg = state.tpSwapConfig;
      const swapDirection = swapCfg.enabled
        ? swapDirectionMap[computeSwapDirection(swapCfg.swapToQuote, tokenInfo.isToken0Quote)]
        : 0;
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);

      calls.push({
        functionName: 'registerOrder',
        args: [
          {
            nftId: nftIdBigInt,
            pool: poolAddress,
            triggerMode: tpContractMode,
            triggerTick: currentTpTick,
            payout: connectedAddress as Address,
            operator: autowalletAddress,
            validUntil,
            slippageBps: swapCfg.exitSlippageBps,
            swapDirection,
            swapSlippageBps: swapCfg.enabled ? swapCfg.slippageBps : 0,
          },
        ],
      });
    }

    return calls.length > 0 ? calls : null;
  }, [
    nftId, tokenInfo, autowalletData, slOperation, tpOperation,
    slSwapChanged, tpSwapChanged, currentSlTick, currentTpTick,
    state.stopLoss, state.takeProfit, state.slSwapConfig, state.tpSwapConfig,
    state.initialStopLoss.hasFailedOnChainOrder, state.initialTakeProfit.hasFailedOnChainOrder,
    poolAddress, connectedAddress,
  ]);

  // ----- Execution state -----
  // Phase: idle → approval → multicall → done
  const [phase, setPhase] = useState<'idle' | 'approval' | 'multicall' | 'done'>('idle');
  const [approvalDone, setApprovalDone] = useState(false);
  const [subOpsExpanded, setSubOpsExpanded] = useState(true);

  // Helper to check if error is user rejection
  const isUserRejection = (error: Error | null | undefined): boolean => {
    if (!error) return false;
    const message = error.message?.toLowerCase() || '';
    return message.includes('user rejected') || message.includes('user denied');
  };

  // Watch approval completion
  useEffect(() => {
    if (phase !== 'approval') return;

    if (operatorApproval.isApprovalSuccess || operatorApproval.isApproved) {
      setApprovalDone(true);
      setPhase('multicall');
    }
  }, [phase, operatorApproval.isApprovalSuccess, operatorApproval.isApproved]);

  // Watch multicall completion
  useEffect(() => {
    if (phase !== 'multicall') return;

    if (multicall.isSuccess) {
      setPhase('done');
    }
  }, [phase, multicall.isSuccess]);

  // Skip approval phase if not needed and initialize to correct phase
  useEffect(() => {
    if (phase !== 'idle') return;
    if (operatorApproval.isChecking) return;

    // If no approval needed and no sub-operations, nothing to do
    if (!needsApproval && subOperations.length === 0) return;
  }, [phase, operatorApproval.isChecking, needsApproval, subOperations.length]);

  const isDone = phase === 'done';

  // ----- Backend tx watchers -----
  const approvalPrompt = useEvmTransactionPrompt({
    label: 'Approve automation contract',
    buttonLabel: 'Execute',
    retryButtonLabel: 'Retry',
    chainId,
    enabled: !!contractAddress,
    showActionButton: needsApproval && !approvalDone,
    txHash: operatorApproval.txHash,
    isSubmitting: operatorApproval.isApproving,
    isWaitingForConfirmation: operatorApproval.isWaitingForConfirmation,
    isSuccess: approvalDone || operatorApproval.isApprovalSuccess || operatorApproval.isApproved,
    error: operatorApproval.error,
    onExecute: () => {
      if (operatorApproval.error) operatorApproval.reset();
      setPhase('approval');
      operatorApproval.approve();
    },
    onReset: () => operatorApproval.reset(),
  });

  const multicallPrompt = useEvmTransactionPrompt({
    label: subOperations.length === 1
      ? subOperations[0].label
      : `Apply ${subOperations.length} Order Changes`,
    chainId,
    enabled: !!contractAddress && subOperations.length > 0,
    showActionButton: false,
    txHash: multicall.txHash,
    isSubmitting: multicall.isSubmitting,
    isWaitingForConfirmation: multicall.isWaitingForConfirmation,
    isSuccess: multicall.isSuccess,
    error: multicall.error,
  });
  // Suppress unused variable — multicallPrompt is used only for its backend subscription side-effect
  void multicallPrompt;

  // ----- Handlers -----
  const handleExecuteMulticall = useCallback(() => {
    if (multicall.error) {
      multicall.reset();
    }

    const calls = buildMulticallCalls();
    if (!calls) {
      return;
    }

    setPhase('multicall');
    multicall.execute(calls);
  }, [multicall, buildMulticallCalls]);

  const handleRetryMulticall = useCallback(() => {
    multicall.reset();
    const calls = buildMulticallCalls();
    if (!calls) return;
    multicall.execute(calls);
  }, [multicall, buildMulticallCalls]);

  // Handle finish
  const handleFinish = useCallback(() => {
    navigate(returnTo);
  }, [navigate, returnTo]);

  // ============================================================
  // Render: Multicall row with sub-items
  // ============================================================
  const renderMulticallRow = () => {
    if (subOperations.length === 0) return null;

    const isActive = multicall.isSubmitting || multicall.isWaitingForConfirmation;
    const multicallError = isUserRejection(multicall.error) ? null : multicall.error;
    const isError = !!multicallError;
    const isSuccess = multicall.isSuccess;
    const isPending = !isActive && !isError && !isSuccess;

    // Show Execute button when: approval is done (or not needed) AND multicall not yet executing
    const approvalComplete = !needsApproval || approvalDone || operatorApproval.isApproved;
    const showButton = approvalComplete && (isPending || isError);

    const label = subOperations.length === 1
      ? subOperations[0].label
      : `Apply ${subOperations.length} Order Changes`;

    return (
      <div
        className={`rounded-lg transition-colors ${
          isError
            ? 'bg-red-500/10 border border-red-500/30'
            : isSuccess
              ? 'bg-green-500/10 border border-green-500/20'
              : isActive
                ? 'bg-blue-500/10 border border-blue-500/20'
                : 'bg-slate-700/30 border border-slate-600/20'
        }`}
      >
        {/* Main row */}
        <div className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Status Icon */}
              {isPending && <Circle className="w-5 h-5 text-slate-500" />}
              {multicall.isSubmitting && <Circle className="w-5 h-5 text-blue-400" />}
              {multicall.isWaitingForConfirmation && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
              {isSuccess && <Check className="w-5 h-5 text-green-400" />}
              {isError && <AlertCircle className="w-5 h-5 text-red-400" />}

              {/* Expand/collapse toggle (only for multiple sub-ops) */}
              {subOperations.length > 1 && (
                <button
                  onClick={() => setSubOpsExpanded(!subOpsExpanded)}
                  className="p-0.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  {subOpsExpanded
                    ? <ChevronDown className="w-4 h-4" />
                    : <ChevronRight className="w-4 h-4" />}
                </button>
              )}

              {/* Label */}
              <span className={isSuccess ? 'text-slate-400' : isError ? 'text-red-300' : 'text-white'}>
                {label}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {multicall.txHash && (
                <a
                  href={buildTxUrl(chainId, multicall.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                >
                  {truncateTxHash(multicall.txHash)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {showButton && (
                <button
                  onClick={isError ? handleRetryMulticall : handleExecuteMulticall}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
                >
                  {isError ? 'Retry' : 'Execute'}
                </button>
              )}
            </div>
          </div>

          {/* Error message */}
          {isError && multicallError && (
            <div className="mt-2 pl-8 flex gap-2">
              <div className="flex-1 max-h-20 overflow-y-auto text-sm text-red-400/80 bg-red-950/30 rounded p-2">
                {multicallError.message}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(multicallError.message)}
                className="flex-shrink-0 p-1.5 text-red-400/60 hover:text-red-400 transition-colors cursor-pointer"
                title="Copy error to clipboard"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Sub-items (only shown when multiple operations and expanded) */}
        {subOperations.length > 1 && subOpsExpanded && (
          <div className="px-4 pb-3 space-y-1.5">
            {subOperations.map((sub) => (
              <div
                key={sub.id}
                className="flex items-center gap-2.5 pl-8 py-1"
              >
                {isSuccess
                  ? <Check className="w-3.5 h-3.5 text-green-400/70" />
                  : isActive
                    ? <Loader2 className="w-3.5 h-3.5 text-blue-400/70 animate-spin" />
                    : <Circle className="w-3.5 h-3.5 text-slate-600" />}
                <span className={`text-sm ${isSuccess ? 'text-slate-500' : 'text-slate-400'}`}>
                  {sub.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ============================================================
  // Interactive panel
  // ============================================================
  const renderInteractive = () => {
    if (!isConnected) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">
            Execute Transactions
          </h3>
          <EvmWalletConnectionPrompt
            title="Connect Wallet"
            description="Connect your wallet to execute the transactions"
          />
        </div>
      );
    }

    if (isWrongNetwork && chainSlug) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">
            Execute Transactions
          </h3>
          <EvmSwitchNetworkPrompt
            chain={chainSlug}
            isWrongNetwork={isWrongNetwork}
          />
        </div>
      );
    }

    // Count total transactions user will sign
    const txCount = (needsApproval ? 1 : 0) + (subOperations.length > 0 ? 1 : 0);

    return (
      <div className="space-y-6">
        <h3 className="text-lg font-semibold text-white">
          Execute Transaction{txCount !== 1 ? 's' : ''}
        </h3>
        <div className="space-y-3">
          {(needsApproval || approvalDone) && approvalPrompt.element}
          {renderMulticallRow()}
        </div>
      </div>
    );
  };

  // ============================================================
  // Visual panel (empty for transaction step)
  // ============================================================
  const renderVisual = () => null;

  // ============================================================
  // Summary panel
  // ============================================================
  const renderSummary = () => {
    const quoteDecimals = tokenInfo?.quoteDecimals ?? 18;
    const quoteSymbol = tokenInfo?.quoteSymbol ?? '';

    // Count actual wallet signatures needed
    const txCount = (needsApproval ? 1 : 0) + (subOperations.length > 0 ? 1 : 0);

    return (
      <div className="h-full flex flex-col">
        {/* Header with zoom controls */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Summary</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                setSummaryZoom(
                  Math.max(state.summaryZoom - ZOOM_STEP, ZOOM_MIN)
                )
              }
              disabled={state.summaryZoom <= ZOOM_MIN}
              className={`p-1 rounded transition-colors cursor-pointer ${
                state.summaryZoom <= ZOOM_MIN
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
              title="Zoom out"
            >
              <MinusCircle className="w-4 h-4" />
            </button>
            <button
              onClick={() =>
                setSummaryZoom(
                  Math.min(state.summaryZoom + ZOOM_STEP, ZOOM_MAX)
                )
              }
              disabled={state.summaryZoom >= ZOOM_MAX}
              className={`p-1 rounded transition-colors cursor-pointer ${
                state.summaryZoom >= ZOOM_MAX
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
              title="Zoom in"
            >
              <PlusCircle className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-auto">
          {/* Operations count */}
          <div className="p-3 bg-slate-700/30 rounded-lg">
            <p className="text-xs text-slate-400 mb-1">Transactions</p>
            <p className="text-lg font-semibold text-white">
              {txCount}{' '}
              <span className="text-sm font-normal text-slate-400">
                {txCount === 1 ? 'transaction' : 'transactions'}
                {subOperations.length > 1 && ` (${subOperations.length} operations batched)`}
              </span>
            </p>
          </div>

          {/* Final trigger config */}
          <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
            <p className="text-xs text-slate-400">Final Configuration</p>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Stop Loss</span>
                {state.stopLoss.enabled && state.stopLoss.priceBigint ? (
                  <span className="text-red-400 font-medium">
                    {formatCompactValue(
                      state.stopLoss.priceBigint,
                      quoteDecimals
                    )}{' '}
                    {quoteSymbol}
                  </span>
                ) : (
                  <span className="text-slate-500">None</span>
                )}
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Take Profit</span>
                {state.takeProfit.enabled && state.takeProfit.priceBigint ? (
                  <span className="text-green-400 font-medium">
                    {formatCompactValue(
                      state.takeProfit.priceBigint,
                      quoteDecimals
                    )}{' '}
                    {quoteSymbol}
                  </span>
                ) : (
                  <span className="text-slate-500">None</span>
                )}
              </div>
              {state.stopLoss.enabled && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">SL Swap</span>
                  <span
                    className={
                      state.slSwapConfig.enabled
                        ? 'text-blue-400 font-medium'
                        : 'text-slate-500'
                    }
                  >
                    {state.slSwapConfig.enabled
                      ? `to ${quoteSymbol} (${(state.slSwapConfig.slippageBps / 100).toFixed(1)}%)`
                      : 'Disabled'}
                  </span>
                </div>
              )}
              {state.takeProfit.enabled && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">TP Swap</span>
                  <span
                    className={
                      state.tpSwapConfig.enabled
                        ? 'text-blue-400 font-medium'
                        : 'text-slate-500'
                    }
                  >
                    {state.tpSwapConfig.enabled
                      ? `to ${quoteSymbol} (${(state.tpSwapConfig.slippageBps / 100).toFixed(1)}%)`
                      : 'Disabled'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-3 mt-6 pt-4 border-t border-slate-700/50">
          <button
            onClick={goBack}
            className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            Back
          </button>
          {isDone ? (
            <button
              onClick={handleFinish}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors cursor-pointer"
            >
              Finish
            </button>
          ) : (
            <button
              disabled
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg opacity-50 cursor-not-allowed"
            >
              Next
            </button>
          )}
        </div>
      </div>
    );
  };

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
