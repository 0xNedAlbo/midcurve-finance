import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Check,
  Pause,
  Radio,
  Loader2,
  AlertCircle,
  Shield,
  ArrowRight,
} from 'lucide-react';
import { formatCompactValue } from '@midcurve/shared';
import { useRiskTriggersWizard } from '../context/RiskTriggersWizardContext';
import { useSetAutomationState } from '@/hooks/automation/useSetAutomationState';
import {
  formatTriggerPriceFromTick,
  type TokenConfig,
} from '@/components/positions/automation/order-button-utils';

interface OrderToggleState {
  closeOrderHash: string;
  label: string;
  triggerTick: number | null;
  activate: boolean;
}

export function ActivationStep() {
  const { state } = useRiskTriggersWizard();

  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo || '/dashboard';

  const setAutomationState = useSetAutomationState();

  const position = state.position;

  // Extract chain and NFT info
  const chainId = useMemo(() => {
    if (!position) return 0;
    return (position.config as { chainId: number }).chainId;
  }, [position]);

  const nftId = useMemo(() => {
    if (!position) return '';
    return (position.config as { nftId: number }).nftId.toString();
  }, [position]);

  // Token info for price formatting
  const tokenConfig = useMemo((): TokenConfig | null => {
    if (!position) return null;
    const baseToken = position.isToken0Quote
      ? position.pool.token1
      : position.pool.token0;
    const quoteToken = position.isToken0Quote
      ? position.pool.token0
      : position.pool.token1;
    return {
      baseTokenAddress: (baseToken.config as { address: string }).address,
      quoteTokenAddress: (quoteToken.config as { address: string }).address,
      baseTokenDecimals: baseToken.decimals,
      quoteTokenDecimals: quoteToken.decimals,
      baseTokenSymbol: baseToken.symbol,
      quoteTokenSymbol: quoteToken.symbol,
    };
  }, [position]);

  // Determine which orders exist (from current state after transaction)
  const slOrder = useMemo(() => {
    if (!state.stopLoss.enabled || !state.stopLoss.closeOrderHash) return null;
    return {
      closeOrderHash: state.stopLoss.closeOrderHash,
      triggerTick: state.stopLoss.triggerTick,
      label: 'Stop Loss',
    };
  }, [state.stopLoss]);

  const tpOrder = useMemo(() => {
    if (!state.takeProfit.enabled || !state.takeProfit.closeOrderHash)
      return null;
    return {
      closeOrderHash: state.takeProfit.closeOrderHash,
      triggerTick: state.takeProfit.triggerTick,
      label: 'Take Profit',
    };
  }, [state.takeProfit]);

  // Initialize toggle state from context desired automation state
  const [slActivate, setSlActivate] = useState(
    state.slDesiredAutomationState === 'monitoring'
  );
  const [tpActivate, setTpActivate] = useState(
    state.tpDesiredAutomationState === 'monitoring'
  );

  // Execution state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  const hasAnyOrder = slOrder !== null || tpOrder !== null;
  const hasAnyActivation =
    (slOrder && slActivate) || (tpOrder && tpActivate);

  // Build the list of orders to process
  const ordersToProcess = useMemo((): OrderToggleState[] => {
    const orders: OrderToggleState[] = [];
    if (slOrder) {
      orders.push({ ...slOrder, activate: slActivate });
    }
    if (tpOrder) {
      orders.push({ ...tpOrder, activate: tpActivate });
    }
    return orders;
  }, [slOrder, tpOrder, slActivate, tpActivate]);

  // Handle confirm & finish
  const handleConfirm = useCallback(async () => {
    if (ordersToProcess.length === 0) {
      navigate(returnTo);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const mutations = ordersToProcess.map((order) =>
      setAutomationState.mutateAsync({
        chainId,
        nftId,
        closeOrderHash: order.closeOrderHash,
        automationState: order.activate ? 'monitoring' : 'paused',
      })
    );

    try {
      await Promise.all(mutations);
      setIsDone(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to set automation state'
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [ordersToProcess, chainId, nftId, setAutomationState, navigate, returnTo]);

  // Handle skip
  const handleSkip = useCallback(() => {
    navigate(returnTo);
  }, [navigate, returnTo]);

  // Handle finish after success
  const handleFinish = useCallback(() => {
    navigate(returnTo);
  }, [navigate, returnTo]);

  // Format trigger price for display
  const formatPrice = useCallback(
    (triggerTick: number | null): string => {
      if (!tokenConfig) return '-';
      return formatTriggerPriceFromTick(triggerTick, tokenConfig);
    },
    [tokenConfig]
  );

  // ============================================================
  // Interactive panel
  // ============================================================
  const renderInteractive = () => {
    if (!hasAnyOrder) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">
            Activate Monitoring
          </h3>
          <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/30 text-center">
            <p className="text-slate-400">
              No active orders to configure monitoring for.
            </p>
          </div>
          <button
            onClick={handleSkip}
            className="w-full py-3 px-4 bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition-colors cursor-pointer"
          >
            Return to Dashboard
          </button>
        </div>
      );
    }

    if (isDone) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">
            Monitoring Configured
          </h3>
          <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/20">
            <div className="flex items-center gap-3">
              <Check className="w-6 h-6 text-green-400 flex-shrink-0" />
              <div>
                <p className="text-green-300 font-medium">
                  Automation state updated successfully
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  Your orders have been configured. Active orders will be
                  monitored for trigger conditions.
                </p>
              </div>
            </div>
          </div>

          {/* Show final status per order */}
          <div className="space-y-2">
            {ordersToProcess.map((order) => (
              <div
                key={order.closeOrderHash}
                className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg border border-slate-600/20"
              >
                <span className="text-sm text-white">{order.label}</span>
                <span
                  className={`text-sm font-medium ${
                    order.activate ? 'text-green-400' : 'text-slate-400'
                  }`}
                >
                  {order.activate ? 'Monitoring' : 'Paused'}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={handleFinish}
            className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            Finish
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <h3 className="text-lg font-semibold text-white">
          Activate Monitoring
        </h3>
        <p className="text-sm text-slate-400">
          Choose which orders to start monitoring. Monitored orders will
          automatically execute when their trigger price is reached.
        </p>

        {/* Order toggles */}
        <div className="space-y-3">
          {slOrder && (
            <OrderToggleCard
              label="Stop Loss"
              priceDisplay={formatPrice(slOrder.triggerTick)}
              quoteSymbol={tokenConfig?.quoteTokenSymbol ?? ''}
              isActive={slActivate}
              onToggle={() => setSlActivate(!slActivate)}
              colorClass="text-red-400"
              disabled={isSubmitting}
            />
          )}
          {tpOrder && (
            <OrderToggleCard
              label="Take Profit"
              priceDisplay={formatPrice(tpOrder.triggerTick)}
              quoteSymbol={tokenConfig?.quoteTokenSymbol ?? ''}
              isActive={tpActivate}
              onToggle={() => setTpActivate(!tpActivate)}
              colorClass="text-green-400"
              disabled={isSubmitting}
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <button
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <ArrowRight className="w-4 h-4" />
                Confirm & Finish
              </>
            )}
          </button>
          <button
            onClick={handleSkip}
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            Skip — Leave Paused
          </button>
        </div>
      </div>
    );
  };

  // ============================================================
  // Visual panel
  // ============================================================
  const renderVisual = () => {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <div className="text-center space-y-4 max-w-sm">
          <div className="mx-auto w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Shield className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">
            Automation Setup
          </h3>
          <p className="text-sm text-slate-400">
            {isDone
              ? 'Your monitoring preferences have been saved. Active orders will trigger automatically.'
              : 'Enable monitoring to have your orders automatically execute when trigger conditions are met.'}
          </p>
          {hasAnyActivation && !isDone && (
            <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <p className="text-xs text-blue-300">
                Monitored orders are checked continuously. When the market price
                crosses your trigger, execution happens automatically.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============================================================
  // Summary panel
  // ============================================================
  const renderSummary = () => {
    const quoteDecimals = tokenConfig?.quoteTokenDecimals ?? 18;
    const quoteSymbol = tokenConfig?.quoteTokenSymbol ?? '';

    return (
      <div className="h-full flex flex-col">
        <h3 className="text-lg font-semibold text-white mb-4">
          Order Status
        </h3>

        <div className="flex-1 space-y-4 overflow-auto">
          {/* Stop Loss summary */}
          <div className="p-3 bg-slate-700/30 rounded-lg space-y-2">
            <p className="text-xs text-slate-400 uppercase tracking-wide">
              Stop Loss
            </p>
            {state.stopLoss.enabled && state.stopLoss.priceBigint ? (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Trigger Price</span>
                  <span className="text-red-400 font-medium">
                    {formatCompactValue(
                      state.stopLoss.priceBigint,
                      quoteDecimals
                    )}{' '}
                    {quoteSymbol}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Monitoring</span>
                  {isDone ? (
                    <span
                      className={`font-medium ${
                        slActivate ? 'text-green-400' : 'text-slate-500'
                      }`}
                    >
                      {slActivate ? 'Active' : 'Paused'}
                    </span>
                  ) : (
                    <span
                      className={`font-medium ${
                        slActivate ? 'text-blue-400' : 'text-slate-500'
                      }`}
                    >
                      {slActivate ? 'Will activate' : 'Will stay paused'}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Not configured</p>
            )}
          </div>

          {/* Take Profit summary */}
          <div className="p-3 bg-slate-700/30 rounded-lg space-y-2">
            <p className="text-xs text-slate-400 uppercase tracking-wide">
              Take Profit
            </p>
            {state.takeProfit.enabled && state.takeProfit.priceBigint ? (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Trigger Price</span>
                  <span className="text-green-400 font-medium">
                    {formatCompactValue(
                      state.takeProfit.priceBigint,
                      quoteDecimals
                    )}{' '}
                    {quoteSymbol}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Monitoring</span>
                  {isDone ? (
                    <span
                      className={`font-medium ${
                        tpActivate ? 'text-green-400' : 'text-slate-500'
                      }`}
                    >
                      {tpActivate ? 'Active' : 'Paused'}
                    </span>
                  ) : (
                    <span
                      className={`font-medium ${
                        tpActivate ? 'text-blue-400' : 'text-slate-500'
                      }`}
                    >
                      {tpActivate ? 'Will activate' : 'Will stay paused'}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Not configured</p>
            )}
          </div>

          {/* Status indicator */}
          {isDone && (
            <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/20">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400" />
                <p className="text-sm text-green-300">
                  Setup complete
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-6 pt-4 border-t border-slate-700/50">
          {isDone ? (
            <button
              onClick={handleFinish}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors cursor-pointer"
            >
              Finish
            </button>
          ) : (
            <button
              onClick={handleSkip}
              disabled={isSubmitting}
              className="w-full px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
            >
              Skip
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

// ============================================================
// OrderToggleCard — individual order with toggle
// ============================================================

interface OrderToggleCardProps {
  label: string;
  priceDisplay: string;
  quoteSymbol: string;
  isActive: boolean;
  onToggle: () => void;
  colorClass: string;
  disabled: boolean;
}

function OrderToggleCard({
  label,
  priceDisplay,
  quoteSymbol,
  isActive,
  onToggle,
  colorClass,
  disabled,
}: OrderToggleCardProps) {
  return (
    <div
      className={`p-4 rounded-lg border transition-colors ${
        isActive
          ? 'bg-blue-500/10 border-blue-500/30'
          : 'bg-slate-700/30 border-slate-600/30'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {isActive ? (
              <Radio className="w-4 h-4 text-blue-400" />
            ) : (
              <Pause className="w-4 h-4 text-slate-500" />
            )}
            <span className="text-sm font-medium text-white">{label}</span>
          </div>
          <p className="text-sm text-slate-400 pl-6">
            Trigger at{' '}
            <span className={colorClass}>
              {priceDisplay} {quoteSymbol}
            </span>
          </p>
        </div>

        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          onClick={onToggle}
          disabled={disabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            isActive ? 'bg-blue-600' : 'bg-slate-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              isActive ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-2 pl-6">
        {isActive ? 'Activate Monitoring' : 'Leave Paused'}
      </p>
    </div>
  );
}
