import { useState, useEffect } from 'react';
import { Loader2, Check, ExternalLink, TrendingDown, TrendingUp } from 'lucide-react';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';

interface OrderRegistration {
  type: 'stop-loss' | 'take-profit';
  status: 'pending' | 'registering' | 'registered' | 'error';
  txHash?: string;
}

export function RegisterOrdersStep() {
  const { state, setStepValid, addTransaction } = useCreatePositionWizard();

  const [stopLossOrder, setStopLossOrder] = useState<OrderRegistration>({
    type: 'stop-loss',
    status: state.stopLossEnabled ? 'pending' : 'registered', // Skip if not enabled
  });
  const [takeProfitOrder, setTakeProfitOrder] = useState<OrderRegistration>({
    type: 'take-profit',
    status: state.takeProfitEnabled ? 'pending' : 'registered', // Skip if not enabled
  });

  // Validate step
  useEffect(() => {
    const slDone = !state.stopLossEnabled || stopLossOrder.status === 'registered';
    const tpDone = !state.takeProfitEnabled || takeProfitOrder.status === 'registered';
    setStepValid('register', slDone && tpDone);
  }, [
    state.stopLossEnabled,
    state.takeProfitEnabled,
    stopLossOrder.status,
    takeProfitOrder.status,
    setStepValid,
  ]);

  const handleRegisterOrder = async (orderType: 'stop-loss' | 'take-profit') => {
    const setOrder = orderType === 'stop-loss' ? setStopLossOrder : setTakeProfitOrder;

    setOrder((prev) => ({ ...prev, status: 'registering' }));

    try {
      // Simulate registration
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const mockTxHash = `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;

      addTransaction({
        hash: mockTxHash,
        type: orderType === 'stop-loss' ? 'register-sl' : 'register-tp',
        label: orderType === 'stop-loss' ? 'Register Stop Loss' : 'Register Take Profit',
        status: 'confirmed',
      });

      setOrder({ type: orderType, status: 'registered', txHash: mockTxHash });
    } catch (err) {
      setOrder((prev) => ({ ...prev, status: 'error' }));
    }
  };

  const handleRegisterAll = async () => {
    if (state.stopLossEnabled && stopLossOrder.status === 'pending') {
      await handleRegisterOrder('stop-loss');
    }
    if (state.takeProfitEnabled && takeProfitOrder.status === 'pending') {
      await handleRegisterOrder('take-profit');
    }
  };

  const renderOrderCard = (
    order: OrderRegistration,
    tick: number | null,
    onRegister: () => void
  ) => {
    const isStopLoss = order.type === 'stop-loss';
    const Icon = isStopLoss ? TrendingDown : TrendingUp;
    const color = isStopLoss ? 'orange' : 'green';

    return (
      <div
        className={`p-4 rounded-lg border transition-colors ${
          order.status === 'registered'
            ? `bg-${color}-600/10 border-${color}-500/30`
            : 'bg-slate-700/30 border-slate-600/30'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Icon className={`w-5 h-5 text-${color}-400`} />
            <div>
              <p className="text-white font-medium">
                {isStopLoss ? 'Stop Loss' : 'Take Profit'}
              </p>
              <p className="text-sm text-slate-400">Trigger at tick {tick}</p>
            </div>
          </div>

          {order.status === 'registered' && (
            <div className={`flex items-center gap-2 text-${color}-400`}>
              <Check className="w-5 h-5" />
              <span className="text-sm font-medium">Registered</span>
            </div>
          )}
        </div>

        {order.status === 'pending' && (
          <button
            onClick={onRegister}
            className={`w-full py-2 bg-${color}-600 text-white rounded-lg font-medium hover:bg-${color}-700 transition-colors cursor-pointer`}
          >
            Register {isStopLoss ? 'Stop Loss' : 'Take Profit'}
          </button>
        )}

        {order.status === 'registering' && (
          <button
            disabled
            className={`w-full py-2 bg-${color}-600/50 text-white rounded-lg font-medium flex items-center justify-center gap-2 cursor-wait`}
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Registering...
          </button>
        )}

        {order.status === 'registered' && order.txHash && (
          <a
            href={`https://etherscan.io/tx/${order.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
          >
            View Transaction
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  };

  const allPending =
    (state.stopLossEnabled && stopLossOrder.status === 'pending') ||
    (state.takeProfitEnabled && takeProfitOrder.status === 'pending');

  const renderInteractive = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Register Automation Orders</h3>

      <p className="text-slate-400">
        Register your stop-loss and take-profit orders with the automation system.
        These orders will be executed automatically when the price reaches your trigger levels.
      </p>

      <div className="space-y-4">
        {state.stopLossEnabled &&
          renderOrderCard(stopLossOrder, state.stopLossTick, () =>
            handleRegisterOrder('stop-loss')
          )}
        {state.takeProfitEnabled &&
          renderOrderCard(takeProfitOrder, state.takeProfitTick, () =>
            handleRegisterOrder('take-profit')
          )}
      </div>

      {/* Register all button */}
      {allPending && (
        <button
          onClick={handleRegisterAll}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
        >
          Register All Orders
        </button>
      )}

      {/* All registered message */}
      {stopLossOrder.status === 'registered' && takeProfitOrder.status === 'registered' && (
        <div className="p-4 bg-green-600/10 border border-green-500/30 rounded-lg">
          <p className="text-green-400 text-center font-medium">
            All orders registered! Your position is now protected.
          </p>
        </div>
      )}
    </div>
  );

  const renderVisual = () => (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Position with Automation</h3>

      {/* PnL curve with SL/TP markers */}
      <div className="flex-1 flex items-center justify-center bg-slate-700/20 rounded-lg border border-slate-600/30">
        <div className="w-full max-w-lg p-4">
          <svg viewBox="0 0 400 250" className="w-full h-64">
            {/* Background */}
            <rect width="400" height="250" fill="#1e293b" fillOpacity="0.3" />

            {/* Zero line */}
            <line x1="0" y1="125" x2="400" y2="125" stroke="#475569" strokeWidth="1" />

            {/* Range boundaries */}
            <line x1="80" y1="0" x2="80" y2="250" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4" />
            <line x1="320" y1="0" x2="320" y2="250" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4" />

            {/* PnL curve */}
            <path
              d="M 0 200 L 80 150 Q 200 80 320 150 L 400 200"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
            />

            {/* Current price */}
            <line x1="200" y1="0" x2="200" y2="250" stroke="#eab308" strokeWidth="2" />
            <circle cx="200" cy="115" r="6" fill="#eab308" />

            {/* Stop Loss marker */}
            {state.stopLossEnabled && (
              <>
                <line x1="60" y1="0" x2="60" y2="250" stroke="#f97316" strokeWidth="2" />
                <circle cx="60" cy="180" r="8" fill={stopLossOrder.status === 'registered' ? '#f97316' : '#6b7280'} />
                <text x="45" y="15" fill="#f97316" fontSize="10">SL</text>
              </>
            )}

            {/* Take Profit marker */}
            {state.takeProfitEnabled && (
              <>
                <line x1="340" y1="0" x2="340" y2="250" stroke="#22c55e" strokeWidth="2" />
                <circle cx="340" cy="180" r="8" fill={takeProfitOrder.status === 'registered' ? '#22c55e' : '#6b7280'} />
                <text x="330" y="15" fill="#22c55e" fontSize="10">TP</text>
              </>
            )}
          </svg>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <span className="text-slate-400">Current Price</span>
        </div>
        {state.stopLossEnabled && (
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                stopLossOrder.status === 'registered' ? 'bg-orange-400' : 'bg-gray-500'
              }`}
            />
            <span className="text-slate-400">Stop Loss</span>
          </div>
        )}
        {state.takeProfitEnabled && (
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                takeProfitOrder.status === 'registered' ? 'bg-green-400' : 'bg-gray-500'
              }`}
            />
            <span className="text-slate-400">Take Profit</span>
          </div>
        )}
      </div>
    </div>
  );

  const allDone =
    (!state.stopLossEnabled || stopLossOrder.status === 'registered') &&
    (!state.takeProfitEnabled || takeProfitOrder.status === 'registered');

  const renderSummary = () => (
    <WizardSummaryPanel nextDisabled={!allDone} nextLabel="View Summary" />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
