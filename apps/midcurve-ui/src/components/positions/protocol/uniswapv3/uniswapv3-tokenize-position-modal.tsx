/**
 * UniswapV3TokenizePositionModal
 *
 * Modal for tokenizing a UniswapV3 position into an ERC-20 vault.
 * Shows vault token parameters (editable), then executes:
 * 1. NFT approval for VaultFactory
 * 2. createVault() on VaultFactory
 * 3. Backend discovery of the new vault position
 *
 * Outstanding fees do not need to be collected before vault creation —
 * the vault's fee accumulator attributes them to the recipient (share owner)
 * regardless of when they were earned.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil, Check, Circle, Loader2, AlertCircle } from 'lucide-react';
import type { Address } from 'viem';
import { useAccount } from 'wagmi';
import { formatCompactValue } from '@midcurve/shared';
import type { UniswapV3PositionData } from '@/hooks/positions/uniswapv3/useUniswapV3Position';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { useChainSharedContract } from '@/hooks/automation/useChainSharedContract';
import { useNftApproval } from '@/hooks/positions/uniswapv3/vault/useNftApproval';
import { useCreateVault } from '@/hooks/positions/uniswapv3/vault/useCreateVault';
import { useDiscoverVaultPosition } from '@/hooks/positions/uniswapv3/vault/useDiscoverVaultPosition';
import { useUniswapV3RefreshPosition } from '@/hooks/positions/uniswapv3/useUniswapV3RefreshPosition';
import { useConfig } from '@/providers/ConfigProvider';

interface UniswapV3TokenizePositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: UniswapV3PositionData;
}

type EditingField = 'name' | 'symbol' | 'decimals' | null;

/**
 * Compute default vault token decimals from position liquidity.
 * Formula: max(0, floor(log10(L)) - 8)
 */
function computeDefaultDecimals(liquidity: string): number {
  if (!liquidity || liquidity === '0') return 0;
  // floor(log10(L)) = number of digits - 1
  const digits = liquidity.length;
  return Math.max(0, digits - 1 - 8);
}

export function UniswapV3TokenizePositionModal({
  isOpen,
  onClose,
  position,
}: UniswapV3TokenizePositionModalProps) {
  const chainId = position.config.chainId;
  const nftId = position.config.nftId;
  const liquidity = position.state.liquidity;

  const [mounted, setMounted] = useState(false);

  // Editable vault token parameters
  const defaultDecimals = computeDefaultDecimals(liquidity);
  const [tokenName, setTokenName] = useState(`UniswapV3 Tokenized Position #${nftId}`);
  const [tokenSymbol, setTokenSymbol] = useState(`UV3-${chainId}-${nftId}`);
  const [decimals, setDecimals] = useState(defaultDecimals);

  // Editing state
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [editValue, setEditValue] = useState('');

  // Track discover step
  const [discoverStatus, setDiscoverStatus] = useState<'idle' | 'active' | 'success' | 'error'>('idle');

  useEffect(() => {
    setMounted(true);
  }, []);

  // Get factory address from shared contracts
  const { data: sharedContract } = useChainSharedContract(chainId);
  const factoryAddress = sharedContract?.contracts['UniswapV3VaultFactory']?.contractAddress as Address | undefined;

  const { address: connectedAddress } = useAccount();
  const { operatorAddress } = useConfig();

  // NFT approval hook
  const nftApproval = useNftApproval(chainId, BigInt(nftId), factoryAddress);

  // Create vault hook
  const createVault = useCreateVault({
    chainId,
    factoryAddress,
    nftId: BigInt(nftId),
    tokenName,
    tokenSymbol,
    decimals,
    operatorAddress: operatorAddress as Address | undefined,
  });

  // Discover vault hook
  const discoverVault = useDiscoverVaultPosition();

  // Refresh the original NFT position so it reflects the vault transfer
  const refreshNftPosition = useUniswapV3RefreshPosition();

  // Approval transaction prompt
  const approvalPrompt = useEvmTransactionPrompt({
    label: 'Approve NFT Transfer',
    buttonLabel: 'Approve',
    chainId,
    enabled: !!factoryAddress,
    showActionButton: !nftApproval.isApproved && !nftApproval.isApproving && !nftApproval.isWaitingForConfirmation,
    txHash: nftApproval.txHash,
    isSubmitting: nftApproval.isApproving,
    isWaitingForConfirmation: nftApproval.isWaitingForConfirmation,
    isSuccess: nftApproval.isApproved || nftApproval.isApprovalSuccess,
    error: nftApproval.error,
    onExecute: () => nftApproval.approve(),
    onReset: () => nftApproval.reset(),
  });

  // Create vault transaction prompt
  const createVaultPrompt = useEvmTransactionPrompt({
    label: 'Create Vault',
    buttonLabel: 'Create',
    chainId,
    enabled: (nftApproval.isApproved || nftApproval.isApprovalSuccess) && !!factoryAddress,
    showActionButton: (nftApproval.isApproved || nftApproval.isApprovalSuccess) && !createVault.isCreating && !createVault.isWaitingForConfirmation && !createVault.isSuccess,
    txHash: createVault.txHash,
    isSubmitting: createVault.isCreating,
    isWaitingForConfirmation: createVault.isWaitingForConfirmation,
    isSuccess: createVault.isSuccess,
    error: createVault.error,
    onExecute: () => createVault.createVault(),
    onReset: () => createVault.reset(),
  });

  // Auto-trigger discover when vault creation succeeds
  useEffect(() => {
    if (createVault.isSuccess && createVault.vaultAddress && connectedAddress && discoverStatus === 'idle') {
      setDiscoverStatus('active');
      discoverVault.mutate(
        { chainId, vaultAddress: createVault.vaultAddress, shareOwnerAddress: connectedAddress },
        {
          onSuccess: () => {
            setDiscoverStatus('success');
            // Refresh the original NFT position so it reflects the vault transfer
            refreshNftPosition.mutate({ chainId, nftId: String(nftId) });
          },
          onError: () => setDiscoverStatus('error'),
        },
      );
    }
  }, [createVault.isSuccess, createVault.vaultAddress, discoverStatus, chainId, connectedAddress, discoverVault]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setTokenName(`UniswapV3 Tokenized Position #${nftId}`);
      setTokenSymbol(`UV3-${chainId}-${nftId}`);
      setDecimals(computeDefaultDecimals(liquidity));
      setEditingField(null);
      setDiscoverStatus('idle');
      nftApproval.reset();
      nftApproval.refetch();
      createVault.reset();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const isProcessing =
    nftApproval.isApproving || nftApproval.isWaitingForConfirmation ||
    createVault.isCreating || createVault.isWaitingForConfirmation ||
    discoverStatus === 'active';

  const isComplete = discoverStatus === 'success';

  // Edit field handlers
  const startEdit = (field: EditingField) => {
    if (!field) return;
    setEditingField(field);
    if (field === 'name') setEditValue(tokenName);
    else if (field === 'symbol') setEditValue(tokenSymbol);
    else if (field === 'decimals') setEditValue(String(decimals));
  };

  const confirmEdit = () => {
    if (editingField === 'name') setTokenName(editValue);
    else if (editingField === 'symbol') setTokenSymbol(editValue);
    else if (editingField === 'decimals') { const n = Number(editValue); setDecimals(Number.isFinite(n) ? n : defaultDecimals); }
    setEditingField(null);
  };

  const cancelEdit = () => {
    setEditingField(null);
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') confirmEdit();
    else if (e.key === 'Escape') cancelEdit();
  }, [editingField, editValue]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen || !mounted) return null;

  const renderFieldRow = (
    label: string,
    value: string,
    field: EditingField,
    readOnly = false,
  ) => {
    const isEditing = !readOnly && field !== null && editingField === field;

    return (
      <div className="flex items-center justify-between py-2.5 px-3 bg-slate-700/20 rounded-lg">
        <span className="text-sm text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <input
                type={field === 'decimals' ? 'number' : 'text'}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                min={field === 'decimals' ? 0 : undefined}
                max={field === 'decimals' ? 18 : undefined}
                className="w-48 px-2 py-1 bg-slate-800/50 border border-slate-600/30 rounded text-sm text-white text-right focus:outline-none focus:border-blue-500/50"
              />
              <button
                onClick={confirmEdit}
                className="p-1 text-green-400 hover:text-green-300 transition-colors cursor-pointer"
                title="Confirm"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={cancelEdit}
                className="p-1 text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-white font-medium">{value}</span>
              {!readOnly && (
                <button
                  onClick={() => startEdit(field)}
                  className="p-1 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const content = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={isProcessing ? undefined : onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 w-full max-w-lg max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <h2 className="text-lg font-bold text-white">Tokenize Position</h2>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] space-y-5">
            {/* Info Section */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-slate-300 mb-3">Vault Token Parameters</h3>
              {renderFieldRow('Token Name', tokenName, 'name')}
              {renderFieldRow('Token Symbol', tokenSymbol, 'symbol')}
              {renderFieldRow('Decimals', String(decimals), 'decimals')}
              {renderFieldRow('Initial Shares', formatCompactValue(BigInt(liquidity), decimals), null, true)}
            </div>

            {/* Transaction Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-300 mb-3">Transactions</h3>

              {/* 1. NFT Approval */}
              {approvalPrompt.element}

              {/* 2. Create Vault */}
              {createVaultPrompt.element}

              {/* 3. Add to Portfolio (auto-triggered, no button) */}
              <div className={`py-3 px-4 rounded-lg transition-colors ${
                discoverStatus === 'error'
                  ? 'bg-yellow-500/10 border border-yellow-500/30'
                  : discoverStatus === 'success'
                    ? 'bg-green-500/10 border border-green-500/20'
                    : discoverStatus === 'active'
                      ? 'bg-blue-500/10 border border-blue-500/20'
                      : 'bg-slate-700/30 border border-slate-600/20'
              }`}>
                <div className="flex items-center gap-3">
                  {discoverStatus === 'idle' && <Circle className="w-5 h-5 text-slate-500" />}
                  {discoverStatus === 'active' && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
                  {discoverStatus === 'success' && <Check className="w-5 h-5 text-green-400" />}
                  {discoverStatus === 'error' && <AlertCircle className="w-5 h-5 text-yellow-400" />}
                  <span className={
                    discoverStatus === 'success' ? 'text-slate-400'
                      : discoverStatus === 'error' ? 'text-yellow-300'
                        : 'text-white'
                  }>
                    Add to Portfolio
                  </span>
                </div>
              </div>
            </div>

            {/* Success message */}
            {isComplete && createVault.vaultAddress && (
              <div className="p-4 bg-green-600/10 border border-green-500/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <Check className="w-6 h-6 text-green-400" />
                  <div>
                    <p className="text-white font-medium">Position Tokenized</p>
                    <p className="text-sm text-slate-400 mt-0.5">
                      Vault: {createVault.vaultAddress.slice(0, 6)}...{createVault.vaultAddress.slice(-4)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-slate-700/50">
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isComplete ? 'Done' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
