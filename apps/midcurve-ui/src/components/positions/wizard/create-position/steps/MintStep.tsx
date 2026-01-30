import { useState, useEffect } from 'react';
import { Loader2, Check, ExternalLink, AlertCircle } from 'lucide-react';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';

type MintStatus = 'ready' | 'minting' | 'confirming' | 'success' | 'error';

export function MintStep() {
  const {
    state,
    setStepValid,
    addTransaction,
    setPositionCreated,
    goNext,
  } = useCreatePositionWizard();

  const [mintStatus, setMintStatus] = useState<MintStatus>('ready');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token0 = state.selectedPool?.token0;
  const token1 = state.selectedPool?.token1;

  // Validate step
  useEffect(() => {
    setStepValid('mint', mintStatus === 'success');
  }, [mintStatus, setStepValid]);

  const handleMint = async () => {
    setMintStatus('minting');
    setError(null);

    try {
      // Simulate sending transaction
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const mockTxHash = `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
      setTxHash(mockTxHash);
      setMintStatus('confirming');

      // Simulate waiting for confirmation
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Mock position created
      const mockNftId = Math.floor(Math.random() * 1000000).toString();
      const mockPositionId = `pos_${Math.random().toString(36).slice(2)}`;

      addTransaction({
        hash: mockTxHash,
        type: 'mint',
        label: 'Open Position',
        status: 'confirmed',
      });

      setPositionCreated(mockPositionId, mockNftId);
      setMintStatus('success');
    } catch (err) {
      setError('Transaction failed. Please try again.');
      setMintStatus('error');
    }
  };

  const renderInteractive = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Open Position</h3>

      {/* Position summary */}
      <div className="p-4 bg-slate-700/30 rounded-lg space-y-3">
        <div className="flex justify-between">
          <span className="text-slate-400">Pool</span>
          <span className="text-white">
            {token0?.symbol} / {token1?.symbol} ({state.selectedPool?.feeTier})
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Chain</span>
          <span className="text-white">{state.selectedPool?.chainName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">{token0?.symbol} Amount</span>
          <span className="text-white">{state.tokenAAmount || '0'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">{token1?.symbol} Amount</span>
          <span className="text-white">{state.tokenBAmount || '0'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Tick Range</span>
          <span className="text-white font-mono">
            {state.tickLower} → {state.tickUpper}
          </span>
        </div>
      </div>

      {/* Mint button / status */}
      {mintStatus === 'ready' && (
        <button
          onClick={handleMint}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
        >
          Open Position
        </button>
      )}

      {mintStatus === 'minting' && (
        <div className="p-4 bg-blue-600/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            <div>
              <p className="text-white font-medium">Sending transaction...</p>
              <p className="text-sm text-slate-400">Please confirm in your wallet</p>
            </div>
          </div>
        </div>
      )}

      {mintStatus === 'confirming' && txHash && (
        <div className="p-4 bg-yellow-600/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
            <div>
              <p className="text-white font-medium">Waiting for confirmation...</p>
              <a
                href={`https://etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                View on Explorer
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {mintStatus === 'success' && (
        <div className="p-4 bg-green-600/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-3">
            <Check className="w-5 h-5 text-green-400" />
            <div>
              <p className="text-white font-medium">Position created successfully!</p>
              <p className="text-sm text-slate-400">NFT ID: #{state.nftId}</p>
              {txHash && (
                <a
                  href={`https://etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-1"
                >
                  View Transaction
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {mintStatus === 'error' && (
        <div className="space-y-4">
          <div className="p-4 bg-red-600/10 border border-red-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <div>
                <p className="text-white font-medium">Transaction failed</p>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          </div>
          <button
            onClick={handleMint}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );

  const renderVisual = () => (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Position Preview</h3>

      {/* PnL curve */}
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
              stroke={mintStatus === 'success' ? '#22c55e' : '#6b7280'}
              strokeWidth="2"
            />

            {/* Current price */}
            <line x1="200" y1="0" x2="200" y2="200" stroke="#eab308" strokeWidth="2" />
            <circle cx="200" cy="90" r="5" fill="#eab308" />
          </svg>

          {mintStatus === 'success' && (
            <div className="text-center mt-4">
              <p className="text-green-400 font-medium">Position Active</p>
              <p className="text-slate-400 text-sm">NFT #{state.nftId}</p>
            </div>
          )}
        </div>
      </div>

      {/* Transaction status */}
      {txHash && (
        <div className="mt-4 p-3 bg-slate-700/30 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Transaction</span>
            <a
              href={`https://etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              {txHash.slice(0, 10)}...{txHash.slice(-8)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );

  const renderSummary = () => {
    // Determine next step based on automation settings
    const hasAutomation = state.automationEnabled && (state.stopLossEnabled || state.takeProfitEnabled);

    return (
      <WizardSummaryPanel
        nextDisabled={mintStatus !== 'success'}
        nextLabel={hasAutomation ? 'Setup Automation' : 'View Summary'}
        onNext={goNext}
      />
    );
  };

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
