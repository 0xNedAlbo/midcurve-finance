import { useState, useEffect } from 'react';
import { Check, Loader2, ExternalLink } from 'lucide-react';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';

interface ApprovalState {
  status: 'pending' | 'approving' | 'approved' | 'error';
  txHash?: string;
}

export function ApprovalsStep() {
  const { state, setStepValid, addTransaction } = useCreatePositionWizard();

  const [token0Approval, setToken0Approval] = useState<ApprovalState>({ status: 'pending' });
  const [token1Approval, setToken1Approval] = useState<ApprovalState>({ status: 'pending' });

  const token0 = state.selectedPool?.token0;
  const token1 = state.selectedPool?.token1;

  // Check if all approvals are complete
  useEffect(() => {
    const allApproved = token0Approval.status === 'approved' && token1Approval.status === 'approved';
    setStepValid('approvals', allApproved);
  }, [token0Approval.status, token1Approval.status, setStepValid]);

  const handleApprove = async (tokenIndex: 0 | 1) => {
    const token = tokenIndex === 0 ? token0 : token1;
    const setApproval = tokenIndex === 0 ? setToken0Approval : setToken1Approval;

    setApproval({ status: 'approving' });

    // Simulate approval transaction
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const mockTxHash = `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;

    addTransaction({
      hash: mockTxHash,
      type: 'approval',
      label: `Approve ${token?.symbol}`,
      status: 'confirmed',
    });

    setApproval({ status: 'approved', txHash: mockTxHash });
  };

  const renderApprovalCard = (
    tokenIndex: 0 | 1,
    approval: ApprovalState,
    onApprove: () => void
  ) => {
    const token = tokenIndex === 0 ? token0 : token1;
    // Note: For display, we show the user's input amounts
    // The actual approval will use allocatedBaseAmount/allocatedQuoteAmount
    const amount = tokenIndex === 0 ? state.baseInputAmount : state.quoteInputAmount;

    return (
      <div
        className={`p-4 rounded-lg border transition-colors ${
          approval.status === 'approved'
            ? 'bg-green-600/10 border-green-500/30'
            : 'bg-slate-700/30 border-slate-600/30'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-white font-bold">
              {token?.symbol?.charAt(0) || '?'}
            </div>
            <div>
              <p className="text-white font-medium">{token?.symbol}</p>
              <p className="text-sm text-slate-400">{amount || '0'}</p>
            </div>
          </div>

          {approval.status === 'approved' && (
            <div className="flex items-center gap-2 text-green-400">
              <Check className="w-5 h-5" />
              <span className="text-sm font-medium">Approved</span>
            </div>
          )}
        </div>

        {approval.status === 'pending' && (
          <button
            onClick={onApprove}
            className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Approve {token?.symbol}
          </button>
        )}

        {approval.status === 'approving' && (
          <button
            disabled
            className="w-full py-2 bg-blue-600/50 text-white rounded-lg font-medium flex items-center justify-center gap-2 cursor-wait"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Approving...
          </button>
        )}

        {approval.status === 'approved' && approval.txHash && (
          <a
            href={`https://etherscan.io/tx/${approval.txHash}`}
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

  const renderInteractive = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Token Approvals</h3>

      <p className="text-slate-400">
        Before opening a position, you need to approve the Uniswap V3 contract to spend your
        tokens. This is a one-time approval per token.
      </p>

      <div className="space-y-4">
        {renderApprovalCard(0, token0Approval, () => handleApprove(0))}
        {renderApprovalCard(1, token1Approval, () => handleApprove(1))}
      </div>

      {/* All approved message */}
      {token0Approval.status === 'approved' && token1Approval.status === 'approved' && (
        <div className="p-4 bg-green-600/10 border border-green-500/30 rounded-lg">
          <p className="text-green-400 text-center font-medium">
            All tokens approved! Click Next to open your position.
          </p>
        </div>
      )}
    </div>
  );

  const renderVisual = () => (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Position Preview</h3>

      {/* PnL curve preview */}
      <div className="flex-1 flex items-center justify-center bg-slate-700/20 rounded-lg border border-slate-600/30">
        <div className="w-full max-w-lg p-4">
          <svg viewBox="0 0 400 200" className="w-full h-48">
            {/* Zero line */}
            <line x1="0" y1="100" x2="400" y2="100" stroke="#475569" strokeWidth="1" />

            {/* Range boundaries */}
            <line x1="80" y1="0" x2="80" y2="200" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4" />
            <line x1="320" y1="0" x2="320" y2="200" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4" />

            {/* PnL curve */}
            <path
              d="M 0 160 L 80 120 Q 200 60 320 120 L 400 160"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
            />

            {/* Current price */}
            <line x1="200" y1="0" x2="200" y2="200" stroke="#eab308" strokeWidth="2" />
            <circle cx="200" cy="90" r="5" fill="#eab308" />
          </svg>

          <div className="text-center mt-4 text-slate-400 text-sm">
            Your position will be created after approvals
          </div>
        </div>
      </div>

      {/* Approval status summary */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div
          className={`p-3 rounded-lg text-center ${
            token0Approval.status === 'approved'
              ? 'bg-green-600/20 border border-green-500/30'
              : 'bg-slate-700/30'
          }`}
        >
          <p className="text-sm text-slate-400">{token0?.symbol}</p>
          <p
            className={`font-medium ${
              token0Approval.status === 'approved' ? 'text-green-400' : 'text-white'
            }`}
          >
            {token0Approval.status === 'approved' ? 'Approved' : 'Pending'}
          </p>
        </div>
        <div
          className={`p-3 rounded-lg text-center ${
            token1Approval.status === 'approved'
              ? 'bg-green-600/20 border border-green-500/30'
              : 'bg-slate-700/30'
          }`}
        >
          <p className="text-sm text-slate-400">{token1?.symbol}</p>
          <p
            className={`font-medium ${
              token1Approval.status === 'approved' ? 'text-green-400' : 'text-white'
            }`}
          >
            {token1Approval.status === 'approved' ? 'Approved' : 'Pending'}
          </p>
        </div>
      </div>
    </div>
  );

  const renderSummary = () => (
    <WizardSummaryPanel
      nextDisabled={token0Approval.status !== 'approved' || token1Approval.status !== 'approved'}
      nextLabel="Open Position"
    />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
