import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import {
  Circle,
  Check,
  Loader2,
  AlertCircle,
  ExternalLink,
  Copy,
  PlusCircle,
  MinusCircle,
} from 'lucide-react';
import type { Address, Hash } from 'viem';
import {
  formatCompactValue,
  priceToTick,
  getTickSpacing,
} from '@midcurve/shared';
import {
  useRiskTriggersWizard,
  computeSwapToQuoteDirection,
} from '../context/RiskTriggersWizardContext';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { useOperatorApproval } from '@/hooks/automation/useOperatorApproval';
import { useCreateCloseOrder } from '@/hooks/automation/useCreateCloseOrder';
import type {
  RegisterCloseOrderParams,
  OrderType,
  SwapConfig,
} from '@/hooks/automation/useCreateCloseOrder';
import { useUpdateCloseOrder } from '@/hooks/automation/useUpdateCloseOrder';
import type { UpdateCloseOrderParams } from '@/hooks/automation/useUpdateCloseOrder';
import { useCancelCloseOrder } from '@/hooks/automation/useCancelCloseOrder';
import type { CancelCloseOrderParams } from '@/hooks/automation/useCancelCloseOrder';
import { useSharedContract } from '@/hooks/automation/useSharedContract';
import { useAutowallet } from '@/hooks/automation/useAutowallet';
import { getChainSlugByChainId } from '@/config/chains';
import { buildTxUrl, truncateTxHash } from '@/lib/explorer-utils';

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

// ----- Transaction Operation Types -----

interface TxOperation {
  id: string;
  label: string;
  type: 'approval' | 'cancel' | 'update_tick' | 'update_swap' | 'create';
  orderType?: OrderType;
  status: 'pending' | 'signing' | 'confirming' | 'success' | 'error';
  txHash?: Hash;
  error?: string;
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

  const positionOwner = useMemo(() => {
    if (!position) return '' as Address;
    return (position.state as { ownerAddress: string })
      .ownerAddress as Address;
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
  const createOrder = useCreateCloseOrder(chainId, nftId);
  const updateOrder = useUpdateCloseOrder(chainId, nftId);
  const cancelOrder = useCancelCloseOrder(chainId, nftId);

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

  // ----- Build operation queue -----
  const operations = useMemo((): TxOperation[] => {
    const ops: TxOperation[] = [];
    const quoteDecimals = tokenInfo?.quoteDecimals ?? 18;
    const quoteSymbol = tokenInfo?.quoteSymbol ?? '';

    // Determine if we need operator approval
    const needsCreate = slOperation === 'CREATE' || tpOperation === 'CREATE';
    if (needsCreate && !operatorApproval.isApproved) {
      ops.push({
        id: 'approval',
        label: 'Approve automation contract',
        type: 'approval',
        status: 'pending',
      });
    }

    // Cancels first
    if (slOperation === 'CANCEL') {
      ops.push({
        id: 'cancel_sl',
        label: 'Cancel Stop Loss',
        type: 'cancel',
        orderType: 'STOP_LOSS',
        status: 'pending',
      });
    }
    if (tpOperation === 'CANCEL') {
      ops.push({
        id: 'cancel_tp',
        label: 'Cancel Take Profit',
        type: 'cancel',
        orderType: 'TAKE_PROFIT',
        status: 'pending',
      });
    }

    // Updates next
    if (slOperation === 'UPDATE') {
      ops.push({
        id: 'update_sl_tick',
        label: 'Update Stop Loss trigger price',
        type: 'update_tick',
        orderType: 'STOP_LOSS',
        status: 'pending',
      });
    }
    if (tpOperation === 'UPDATE') {
      ops.push({
        id: 'update_tp_tick',
        label: 'Update Take Profit trigger price',
        type: 'update_tick',
        orderType: 'TAKE_PROFIT',
        status: 'pending',
      });
    }

    // Swap updates (per-order)
    if (
      slSwapChanged &&
      state.stopLoss.enabled &&
      slOperation !== 'CREATE' &&
      slOperation !== 'CANCEL'
    ) {
      ops.push({
        id: 'update_sl_swap',
        label: 'Update Stop Loss swap config',
        type: 'update_swap',
        orderType: 'STOP_LOSS',
        status: 'pending',
      });
    }
    if (
      tpSwapChanged &&
      state.takeProfit.enabled &&
      tpOperation !== 'CREATE' &&
      tpOperation !== 'CANCEL'
    ) {
      ops.push({
        id: 'update_tp_swap',
        label: 'Update Take Profit swap config',
        type: 'update_swap',
        orderType: 'TAKE_PROFIT',
        status: 'pending',
      });
    }

    // Creates last
    if (slOperation === 'CREATE') {
      const priceLabel = state.stopLoss.priceBigint
        ? ` at ${formatCompactValue(state.stopLoss.priceBigint, quoteDecimals)} ${quoteSymbol}`
        : '';
      ops.push({
        id: 'create_sl',
        label: `Register Stop Loss${priceLabel}`,
        type: 'create',
        orderType: 'STOP_LOSS',
        status: 'pending',
      });
    }
    if (tpOperation === 'CREATE') {
      const priceLabel = state.takeProfit.priceBigint
        ? ` at ${formatCompactValue(state.takeProfit.priceBigint, quoteDecimals)} ${quoteSymbol}`
        : '';
      ops.push({
        id: 'create_tp',
        label: `Register Take Profit${priceLabel}`,
        type: 'create',
        orderType: 'TAKE_PROFIT',
        status: 'pending',
      });
    }

    return ops;
  }, [
    slOperation,
    tpOperation,
    slSwapChanged,
    tpSwapChanged,
    operatorApproval.isApproved,
    state.stopLoss.enabled,
    state.stopLoss.priceBigint,
    state.takeProfit.enabled,
    state.takeProfit.priceBigint,
    tokenInfo,
  ]);

  // ----- Execution state -----
  const [txOps, setTxOps] = useState<TxOperation[]>([]);
  const txOpsRef = useRef<TxOperation[]>(txOps);
  txOpsRef.current = txOps;
  const [currentOpIndex, setCurrentOpIndex] = useState(-1);
  const [isDone, setIsDone] = useState(false);

  // Initialize txOps from operations once approval check completes
  useEffect(() => {
    if (operations.length > 0 && txOps.length === 0 && !operatorApproval.isChecking) {
      setTxOps([...operations]);
    }
  }, [operations, txOps.length, operatorApproval.isChecking]);

  // Computed: index of the first non-success operation (for Execute button placement)
  const nextPendingIndex = useMemo(() => {
    const idx = txOps.findIndex((op) => op.status !== 'success');
    return idx === -1 ? txOps.length : idx;
  }, [txOps]);

  // ----- Helpers to update tx op status -----
  const updateOp = useCallback(
    (id: string, updates: Partial<TxOperation>) => {
      setTxOps((prev) =>
        prev.map((op) => (op.id === id ? { ...op, ...updates } : op))
      );
    },
    []
  );

  // ----- Execute a specific operation -----
  const handleExecuteOp = useCallback(
    (index: number) => {
      if (currentOpIndex !== -1) return; // Already executing something

      const op = txOps[index];
      if (!op || !tokenInfo || !contractAddress) return;

      const autowalletAddress = autowalletData?.address as
        | Address
        | undefined;

      // If retrying, reset the appropriate hook
      if (op.status === 'error') {
        switch (op.type) {
          case 'approval':
            operatorApproval.reset();
            break;
          case 'cancel':
            cancelOrder.reset();
            break;
          case 'update_tick':
          case 'update_swap':
            updateOrder.reset();
            break;
          case 'create':
            createOrder.reset();
            break;
        }
      }

      setCurrentOpIndex(index);
      updateOp(op.id, {
        status: 'signing',
        error: undefined,
        txHash: undefined,
      });

      // Execute the operation
      switch (op.type) {
        case 'approval': {
          operatorApproval.approve();
          break;
        }
        case 'cancel': {
          const initialTrigger =
            op.orderType === 'STOP_LOSS'
              ? state.initialStopLoss
              : state.initialTakeProfit;
          if (!initialTrigger.closeOrderHash) {
            updateOp(op.id, {
              status: 'error',
              error: 'Missing close order hash',
            });
            setCurrentOpIndex(-1);
            return;
          }
          cancelOrder.reset();
          cancelOrder.cancelOrder({
            orderType: op.orderType!,
            closeOrderHash: initialTrigger.closeOrderHash,
          } as CancelCloseOrderParams);
          break;
        }
        case 'update_tick': {
          const tick =
            op.orderType === 'STOP_LOSS' ? currentSlTick : currentTpTick;
          const initialTrigger =
            op.orderType === 'STOP_LOSS'
              ? state.initialStopLoss
              : state.initialTakeProfit;
          if (tick === null || !initialTrigger.closeOrderHash) {
            updateOp(op.id, {
              status: 'error',
              error: 'Missing tick or hash',
            });
            setCurrentOpIndex(-1);
            return;
          }
          updateOrder.reset();
          updateOrder.updateOrder({
            updateType: 'triggerTick',
            orderType: op.orderType!,
            closeOrderHash: initialTrigger.closeOrderHash,
            triggerTick: tick,
          } as UpdateCloseOrderParams);
          break;
        }
        case 'update_swap': {
          const initialTrigger =
            op.orderType === 'STOP_LOSS'
              ? state.initialStopLoss
              : state.initialTakeProfit;
          if (!initialTrigger.closeOrderHash) {
            updateOp(op.id, {
              status: 'error',
              error: 'Missing close order hash',
            });
            setCurrentOpIndex(-1);
            return;
          }
          const swapCfg =
            op.orderType === 'STOP_LOSS'
              ? state.slSwapConfig
              : state.tpSwapConfig;
          const direction = swapCfg.enabled
            ? computeSwapToQuoteDirection(tokenInfo.isToken0Quote)
            : ('NONE' as const);
          updateOrder.reset();
          updateOrder.updateOrder({
            updateType: 'swapIntent',
            orderType: op.orderType!,
            closeOrderHash: initialTrigger.closeOrderHash,
            direction,
            swapSlippageBps: swapCfg.enabled
              ? swapCfg.slippageBps
              : 0,
          } as UpdateCloseOrderParams);
          break;
        }
        case 'create': {
          const tick =
            op.orderType === 'STOP_LOSS' ? currentSlTick : currentTpTick;
          if (tick === null) {
            updateOp(op.id, {
              status: 'error',
              error: 'Missing trigger tick',
            });
            setCurrentOpIndex(-1);
            return;
          }
          if (!autowalletAddress) {
            updateOp(op.id, {
              status: 'error',
              error: 'Autowallet not available',
            });
            setCurrentOpIndex(-1);
            return;
          }
          const orderSwapCfg =
            op.orderType === 'STOP_LOSS'
              ? state.slSwapConfig
              : state.tpSwapConfig;
          const swapConfig: SwapConfig | undefined = orderSwapCfg.enabled
            ? {
                enabled: true,
                direction: computeSwapToQuoteDirection(
                  tokenInfo.isToken0Quote
                ),
                slippageBps: orderSwapCfg.slippageBps,
              }
            : undefined;

          // 30 days from now
          const validUntil = BigInt(
            Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
          );

          createOrder.reset();
          createOrder.registerOrder({
            poolAddress: poolAddress,
            orderType: op.orderType!,
            triggerTick: tick,
            payoutAddress: connectedAddress as Address,
            operatorAddress: autowalletAddress,
            validUntil,
            slippageBps: 100,
            positionId: position?.id ?? '',
            positionOwner,
            swapConfig,
          } as RegisterCloseOrderParams);
          break;
        }
      }
    },
    [
      currentOpIndex,
      txOps,
      tokenInfo,
      contractAddress,
      autowalletData,
      state,
      operatorApproval,
      cancelOrder,
      updateOrder,
      createOrder,
      currentSlTick,
      currentTpTick,
      poolAddress,
      connectedAddress,
      positionOwner,
      position,
      updateOp,
    ]
  );

  // ----- Watch hook states and update operation status -----

  // Approval
  useEffect(() => {
    if (currentOpIndex < 0) return;
    const op = txOpsRef.current[currentOpIndex];
    if (!op || op.type !== 'approval') return;

    if (operatorApproval.isApprovalSuccess) {
      updateOp(op.id, { status: 'success', txHash: operatorApproval.txHash });
      setCurrentOpIndex(-1);
    } else if (operatorApproval.isWaitingForConfirmation && op.status !== 'confirming') {
      updateOp(op.id, { status: 'confirming' });
    } else if (operatorApproval.error && op.status !== 'error') {
      updateOp(op.id, {
        status: 'error',
        error: operatorApproval.error.message,
      });
      setCurrentOpIndex(-1);
    }
  }, [
    currentOpIndex,
    operatorApproval.isApprovalSuccess,
    operatorApproval.isWaitingForConfirmation,
    operatorApproval.error,
    operatorApproval.txHash,
    updateOp,
  ]);

  // Cancel
  useEffect(() => {
    if (currentOpIndex < 0) return;
    const op = txOpsRef.current[currentOpIndex];
    if (!op || op.type !== 'cancel') return;

    if (cancelOrder.isSuccess) {
      updateOp(op.id, {
        status: 'success',
        txHash: cancelOrder.result?.txHash,
      });
      setCurrentOpIndex(-1);
    } else if (cancelOrder.isWaitingForConfirmation && op.status !== 'confirming') {
      updateOp(op.id, { status: 'confirming' });
    } else if (cancelOrder.error && op.status !== 'error') {
      updateOp(op.id, { status: 'error', error: cancelOrder.error.message });
      setCurrentOpIndex(-1);
    }
  }, [
    currentOpIndex,
    cancelOrder.isSuccess,
    cancelOrder.isWaitingForConfirmation,
    cancelOrder.error,
    cancelOrder.result,
    updateOp,
  ]);

  // Update
  useEffect(() => {
    if (currentOpIndex < 0) return;
    const op = txOpsRef.current[currentOpIndex];
    if (!op || (op.type !== 'update_tick' && op.type !== 'update_swap')) return;

    if (updateOrder.isSuccess) {
      updateOp(op.id, {
        status: 'success',
        txHash: updateOrder.result?.txHash,
      });
      setCurrentOpIndex(-1);
    } else if (updateOrder.isWaitingForConfirmation && op.status !== 'confirming') {
      updateOp(op.id, { status: 'confirming' });
    } else if (updateOrder.error && op.status !== 'error') {
      updateOp(op.id, { status: 'error', error: updateOrder.error.message });
      setCurrentOpIndex(-1);
    }
  }, [
    currentOpIndex,
    updateOrder.isSuccess,
    updateOrder.isWaitingForConfirmation,
    updateOrder.error,
    updateOrder.result,
    updateOp,
  ]);

  // Create
  useEffect(() => {
    if (currentOpIndex < 0) return;
    const op = txOpsRef.current[currentOpIndex];
    if (!op || op.type !== 'create') return;

    if (createOrder.isSuccess) {
      updateOp(op.id, {
        status: 'success',
        txHash: createOrder.result?.txHash,
      });
      setCurrentOpIndex(-1);
    } else if (createOrder.isWaitingForConfirmation && op.status !== 'confirming') {
      updateOp(op.id, { status: 'confirming' });
    } else if (createOrder.error && op.status !== 'error') {
      updateOp(op.id, { status: 'error', error: createOrder.error.message });
      setCurrentOpIndex(-1);
    }
  }, [
    currentOpIndex,
    createOrder.isSuccess,
    createOrder.isWaitingForConfirmation,
    createOrder.error,
    createOrder.result,
    updateOp,
  ]);

  // Check if all operations completed
  useEffect(() => {
    if (txOps.length > 0 && txOps.every((op) => op.status === 'success')) {
      setIsDone(true);
    }
  }, [txOps]);

  // Handle finish
  const handleFinish = useCallback(() => {
    navigate(returnTo);
  }, [navigate, returnTo]);

  // ============================================================
  // Render: Operation row (matches EvmTransactionPrompt visual style)
  // ============================================================
  const renderOperationRow = (op: TxOperation, index: number) => {
    const isActive = op.status === 'signing' || op.status === 'confirming';
    const isError = op.status === 'error';
    const isSuccess = op.status === 'success';
    const isIdle = op.status === 'pending';
    const showButton =
      index === nextPendingIndex &&
      currentOpIndex === -1 &&
      (isIdle || isError);

    return (
      <div
        key={op.id}
        className={`py-3 px-4 rounded-lg transition-colors ${
          isError
            ? 'bg-red-500/10 border border-red-500/30'
            : isSuccess
              ? 'bg-green-500/10 border border-green-500/20'
              : isActive
                ? 'bg-blue-500/10 border border-blue-500/20'
                : 'bg-slate-700/30 border border-slate-600/20'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Status Icon */}
            {isIdle && <Circle className="w-5 h-5 text-slate-500" />}
            {op.status === 'signing' && (
              <Circle className="w-5 h-5 text-blue-400" />
            )}
            {op.status === 'confirming' && (
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            )}
            {isSuccess && <Check className="w-5 h-5 text-green-400" />}
            {isError && <AlertCircle className="w-5 h-5 text-red-400" />}

            {/* Label */}
            <span
              className={
                isSuccess
                  ? 'text-slate-400'
                  : isError
                    ? 'text-red-300'
                    : 'text-white'
              }
            >
              {op.label}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {op.txHash && (
              <a
                href={buildTxUrl(chainId, op.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
              >
                {truncateTxHash(op.txHash)}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {showButton && (
              <button
                onClick={() => handleExecuteOp(index)}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
              >
                {isError ? 'Retry' : 'Execute'}
              </button>
            )}
          </div>
        </div>

        {/* Error message */}
        {isError && op.error && (
          <div className="mt-2 pl-8 flex gap-2">
            <div className="flex-1 max-h-20 overflow-y-auto text-sm text-red-400/80 bg-red-950/30 rounded p-2">
              {op.error}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(op.error!)}
              className="flex-shrink-0 p-1.5 text-red-400/60 hover:text-red-400 transition-colors cursor-pointer"
              title="Copy error to clipboard"
            >
              <Copy className="w-4 h-4" />
            </button>
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

    return (
      <div className="space-y-6">
        <h3 className="text-lg font-semibold text-white">
          Execute Transactions
        </h3>
        <div className="space-y-3">
          {txOps.map((op, index) => renderOperationRow(op, index))}
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
              {txOps.length}{' '}
              <span className="text-sm font-normal text-slate-400">
                {txOps.length === 1 ? 'transaction' : 'transactions'}
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

        {/* Navigation buttons (matching IncreaseDeposit pattern) */}
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
