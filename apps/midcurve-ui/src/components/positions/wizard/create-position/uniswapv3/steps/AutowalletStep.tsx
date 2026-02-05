import { useState, useEffect } from 'react';
import { Wallet, Loader2, Check, ExternalLink, AlertCircle } from 'lucide-react';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';

type AutowalletStatus = 'checking' | 'needs_creation' | 'creating' | 'needs_funding' | 'funding' | 'ready' | 'error';

export function AutowalletStep() {
  const { setStepValid, addTransaction, setNeedsAutowallet } = useCreatePositionWizard();

  const [status, setStatus] = useState<AutowalletStatus>('checking');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Simulate checking for existing autowallet
  useEffect(() => {
    const checkWallet = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // For mockup, assume no wallet exists
      setStatus('needs_creation');
    };
    checkWallet();
  }, []);

  // Validate step
  useEffect(() => {
    setStepValid('autowallet', status === 'ready');
  }, [status, setStepValid]);

  const handleCreateWallet = async () => {
    setStatus('creating');
    setError(null);

    try {
      // Simulate wallet creation
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const mockWalletAddress = `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`;
      setWalletAddress(mockWalletAddress);

      addTransaction({
        hash: `0x${Math.random().toString(16).slice(2)}`,
        type: 'autowallet',
        label: 'Create Autowallet',
        status: 'confirmed',
      });

      setStatus('needs_funding');
    } catch (err) {
      setError('Failed to create autowallet. Please try again.');
      setStatus('error');
    }
  };

  const handleFundWallet = async () => {
    setStatus('funding');
    setError(null);

    try {
      // Simulate funding transaction
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const mockTxHash = `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
      setTxHash(mockTxHash);

      setNeedsAutowallet(false);
      setStatus('ready');
    } catch (err) {
      setError('Failed to fund autowallet. Please try again.');
      setStatus('needs_funding');
    }
  };

  const renderInteractive = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Setup Automation Wallet</h3>

      <p className="text-slate-400">
        To enable automated position management (stop-loss and take-profit), you need a dedicated
        automation wallet that can execute transactions on your behalf.
      </p>

      {/* Status: Checking */}
      {status === 'checking' && (
        <div className="p-4 bg-slate-700/30 rounded-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            <p className="text-white">Checking for existing automation wallet...</p>
          </div>
        </div>
      )}

      {/* Status: Needs Creation */}
      {status === 'needs_creation' && (
        <div className="space-y-4">
          <div className="p-4 bg-yellow-600/10 border border-yellow-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-400" />
              <p className="text-white">No automation wallet found. Create one to continue.</p>
            </div>
          </div>

          <button
            onClick={handleCreateWallet}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Wallet className="w-5 h-5" />
            Create Automation Wallet
          </button>
        </div>
      )}

      {/* Status: Creating */}
      {status === 'creating' && (
        <div className="p-4 bg-blue-600/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            <div>
              <p className="text-white font-medium">Creating automation wallet...</p>
              <p className="text-sm text-slate-400">Please confirm the transaction in your wallet</p>
            </div>
          </div>
        </div>
      )}

      {/* Status: Needs Funding */}
      {status === 'needs_funding' && walletAddress && (
        <div className="space-y-4">
          <div className="p-4 bg-green-600/10 border border-green-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <Check className="w-5 h-5 text-green-400" />
              <div>
                <p className="text-white font-medium">Automation wallet created!</p>
                <p className="text-sm text-slate-400 font-mono">{walletAddress}</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-yellow-600/10 border border-yellow-500/30 rounded-lg">
            <p className="text-white font-medium mb-2">Fund your automation wallet</p>
            <p className="text-sm text-slate-400">
              The wallet needs a small amount of ETH to pay for gas fees when executing
              automated transactions.
            </p>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-slate-400">Recommended amount:</span>
              <span className="text-white font-medium">0.01 ETH (~$25)</span>
            </div>
          </div>

          <button
            onClick={handleFundWallet}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Fund Wallet with 0.01 ETH
          </button>
        </div>
      )}

      {/* Status: Funding */}
      {status === 'funding' && (
        <div className="p-4 bg-blue-600/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            <div>
              <p className="text-white font-medium">Funding automation wallet...</p>
              <p className="text-sm text-slate-400">Please confirm the transaction in your wallet</p>
            </div>
          </div>
        </div>
      )}

      {/* Status: Ready */}
      {status === 'ready' && (
        <div className="p-4 bg-green-600/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-3">
            <Check className="w-5 h-5 text-green-400" />
            <div>
              <p className="text-white font-medium">Automation wallet ready!</p>
              <p className="text-sm text-slate-400">
                Your wallet is funded and ready to execute automated transactions.
              </p>
              {txHash && (
                <a
                  href={`https://etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-1"
                >
                  View Funding Transaction
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status: Error */}
      {status === 'error' && (
        <div className="space-y-4">
          <div className="p-4 bg-red-600/10 border border-red-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <div>
                <p className="text-white font-medium">Error</p>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          </div>
          <button
            onClick={handleCreateWallet}
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
      <h3 className="text-lg font-semibold text-white mb-4">Automation Setup</h3>

      <div className="flex-1 flex items-center justify-center bg-slate-700/20 rounded-lg border border-slate-600/30">
        <div className="text-center p-8">
          <Wallet className="w-20 h-20 text-blue-400 mx-auto mb-6" />

          {status === 'ready' ? (
            <>
              <p className="text-white text-lg font-medium mb-2">Wallet Ready</p>
              <p className="text-slate-400">
                Your automation wallet is set up and funded.
              </p>
            </>
          ) : (
            <>
              <p className="text-white text-lg font-medium mb-2">Automation Wallet</p>
              <p className="text-slate-400">
                A dedicated wallet for executing automated transactions.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Wallet info */}
      {walletAddress && (
        <div className="mt-4 p-3 bg-slate-700/30 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Wallet Address</span>
            <span className="text-white font-mono">{walletAddress}</span>
          </div>
        </div>
      )}
    </div>
  );

  const renderSummary = () => (
    <WizardSummaryPanel
      nextDisabled={status !== 'ready'}
      nextLabel="Register Orders"
    />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
