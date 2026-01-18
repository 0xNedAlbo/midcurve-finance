'use client';

/**
 * DeployStep - Step 3 of Hedge Vault creation wizard
 *
 * Handles the multi-transaction deployment sequence:
 * 1. Deploy HedgeVault contract (get actual vault address)
 * 2. Approve NFT transfer to the deployed vault address
 * 3. Call init(nftId) to transfer the NFT into the vault
 */

import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Check, Circle, ExternalLink, AlertTriangle } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import type { ListPositionData } from '@midcurve/api-shared';
import { CHAIN_METADATA, type EvmChainSlug } from '@/config/chains';
import { getNonfungiblePositionManagerAddress } from '@/config/contracts/nonfungible-position-manager';
import { getAugustusRegistryAddress } from '@/config/contracts/augustus-registry';
import { useApproveNFT } from '@/hooks/hedge/useApproveNFT';
import { useDeployHedgeVault, type DeployHedgeVaultParams } from '@/hooks/hedge/useDeployHedgeVault';
import { useInitHedgeVault } from '@/hooks/hedge/useInitHedgeVault';
import { useAutowallet } from '@/hooks/automation';
import { parseTransactionError } from '@/utils/parse-evm-transaction-error';

interface DeployStepProps {
  position: ListPositionData;
  vaultName: string;
  vaultSymbol: string;
  silSqrtPriceX96: string;
  tipSqrtPriceX96: string;
  lossCapBps: number;
  reopenCooldownBlocks: number;
  onVaultDeployed: (vaultAddress: Address) => void;
  onComplete: () => void;
}

export function DeployStep({
  position,
  vaultName,
  vaultSymbol,
  silSqrtPriceX96,
  tipSqrtPriceX96,
  lossCapBps,
  reopenCooldownBlocks,
  onVaultDeployed,
  onComplete,
}: DeployStepProps) {
  const navigate = useNavigate();
  const { address: walletAddress, isConnected } = useAccount();
  const { data: autowalletData } = useAutowallet();

  // Extract position data
  const positionConfig = position.config as { nftId: number; chainId: number };
  const nftId = BigInt(positionConfig.nftId);
  const chainId = positionConfig.chainId;

  // Get quote token address for vault asset
  const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;
  const quoteTokenConfig = quoteToken.config as { address: string };

  // Track deployed vault address (set after deployment succeeds)
  const [deployedVaultAddress, setDeployedVaultAddress] = useState<Address | null>(null);

  // Get operator address from autowallet
  const operatorAddress = autowalletData?.address as Address | undefined;

  // Get position manager address
  const positionManagerAddress = getNonfungiblePositionManagerAddress(chainId);

  // Get Augustus Registry address for Paraswap
  const augustusRegistryAddress = getAugustusRegistryAddress(chainId);

  // Step 1: Deploy hook
  const deployVault = useDeployHedgeVault();

  // Step 2: NFT Approval hook (enabled only after deployment)
  const nftApproval = useApproveNFT({
    nftId,
    spender: deployedVaultAddress,
    chainId,
    enabled: !!deployedVaultAddress,
  });

  // Step 3: Init hook (transfer NFT to vault)
  const initVault = useInitHedgeVault();

  // Get chain slug for explorer links
  const chainSlug = useMemo(() => {
    const entry = Object.entries(CHAIN_METADATA).find(
      ([_, meta]) => meta.chainId === chainId
    );
    return entry?.[0] as EvmChainSlug | undefined;
  }, [chainId]);

  // Get block explorer URL
  const getExplorerUrl = useCallback(
    (txHash: string | undefined) => {
      if (!txHash || !chainSlug) return null;
      const chainConfig = CHAIN_METADATA[chainSlug];
      if (!chainConfig?.explorer) return null;
      return `${chainConfig.explorer}/tx/${txHash}`;
    },
    [chainSlug]
  );

  // Handle deployment (Step 1)
  const handleDeploy = useCallback(async () => {
    if (!operatorAddress || !positionManagerAddress || !augustusRegistryAddress) {
      console.error('Missing operator, position manager, or augustus registry address');
      return;
    }

    // TODO: Get actual bytecode from contract artifacts
    // For now, use placeholder that will need to be replaced
    const HEDGE_VAULT_BYTECODE = '0x' as `0x${string}`;

    const params: DeployHedgeVaultParams = {
      chainId,
      bytecode: HEDGE_VAULT_BYTECODE,
      constructorParams: {
        positionManager: positionManagerAddress,
        augustusRegistry: augustusRegistryAddress,
        nftId, // Stored in constructor, transferred via init()
        quoteToken: quoteTokenConfig.address as Address,
        operator: operatorAddress,
        silSqrtPriceX96: BigInt(silSqrtPriceX96),
        tipSqrtPriceX96: BigInt(tipSqrtPriceX96),
        lossCapBps,
        reopenCooldownBlocks: BigInt(reopenCooldownBlocks),
        depositMode: 0, // CLOSED - only deployer can deposit
        vaultName,
        vaultSymbol,
      },
    };

    try {
      const result = await deployVault.deploy(params);
      setDeployedVaultAddress(result.vaultAddress);
      onVaultDeployed(result.vaultAddress);
    } catch (error) {
      console.error('Deployment failed:', error);
    }
  }, [
    chainId,
    quoteTokenConfig.address,
    vaultName,
    vaultSymbol,
    nftId,
    silSqrtPriceX96,
    tipSqrtPriceX96,
    lossCapBps,
    reopenCooldownBlocks,
    operatorAddress,
    positionManagerAddress,
    augustusRegistryAddress,
    deployVault,
    onVaultDeployed,
  ]);

  // Handle NFT approval (Step 2)
  const handleApprove = useCallback(() => {
    nftApproval.approve();
  }, [nftApproval]);

  // Handle init (Step 3) - nftId is stored in contract, not passed to init()
  const handleInit = useCallback(async () => {
    if (!deployedVaultAddress) {
      console.error('No vault address available');
      return;
    }

    try {
      await initVault.init({
        chainId,
        vaultAddress: deployedVaultAddress,
      });
    } catch (error) {
      console.error('Init failed:', error);
    }
  }, [chainId, deployedVaultAddress, initVault]);

  // Handle finish - navigate to hedged positions tab
  const handleFinish = useCallback(() => {
    onComplete();
    navigate('/dashboard?tab=hedgedPositions');
  }, [onComplete, navigate]);

  // Check if ready to execute transactions
  const canExecute = isConnected && !!walletAddress && !!operatorAddress && !!augustusRegistryAddress;

  // Determine step states
  const deploymentPending = deployVault.isPending;
  const approvalPending = nftApproval.isApproving || nftApproval.isWaitingForConfirmation;
  const initPending = initVault.isPending;

  // All steps complete
  const allStepsComplete = deployVault.isSuccess && nftApproval.isApproved && initVault.isSuccess;

  return (
    <div className="space-y-6">
      {/* Deployed vault address info */}
      {deployedVaultAddress && (
        <div className="p-4 bg-slate-700/30 border border-slate-600/30 rounded-lg">
          <div className="text-xs text-slate-500 mb-1">Vault Address</div>
          <div className="font-mono text-sm text-slate-300 break-all">
            {deployedVaultAddress}
          </div>
        </div>
      )}

      {/* Transaction Steps */}
      <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
        <h4 className="text-lg font-semibold text-white mb-4">Transaction Steps</h4>

        <div className={`space-y-4 ${!canExecute ? 'opacity-50' : ''}`}>
          {/* Step 1: Deploy Vault */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {deployVault.isSuccess ? (
                <Check className="w-5 h-5 text-green-500" />
              ) : deployVault.isPending ? (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              ) : (
                <Circle className="w-5 h-5 text-slate-400" />
              )}
              <span className="text-white flex-1">Deploy Hedge Vault</span>
              {deployVault.result?.deployTxHash && (
                <a
                  href={getExplorerUrl(deployVault.result.deployTxHash) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  title="View transaction on block explorer"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              {!deployVault.isSuccess && canExecute && (
                <button
                  onClick={handleDeploy}
                  disabled={deploymentPending}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm rounded transition-colors flex items-center gap-2 cursor-pointer"
                >
                  {deploymentPending && <Loader2 className="w-3 h-3 animate-spin" />}
                  {deployVault.isConfirming
                    ? 'Confirming...'
                    : deployVault.isAwaitingSignature
                      ? 'Sign...'
                      : 'Deploy'}
                </button>
              )}
            </div>
            {deployVault.isSuccess && deployVault.result && (
              <div className="text-xs text-green-400 ml-8">
                Vault deployed at {deployVault.result.vaultAddress.slice(0, 10)}...
              </div>
            )}
            {deployVault.error && (
              <div className="ml-8 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-red-400 mb-1">
                      {parseTransactionError(deployVault.error).title}
                    </div>
                    <div className="text-sm text-red-300/90">
                      {parseTransactionError(deployVault.error).message}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Approve NFT */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {nftApproval.isLoadingApproval ? (
                <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
              ) : nftApproval.isApproved ? (
                <Check className="w-5 h-5 text-green-500" />
              ) : (
                <Circle className="w-5 h-5 text-slate-400" />
              )}
              <span className="text-white flex-1">
                Approve NFT Transfer (Position #{positionConfig.nftId})
              </span>
              {nftApproval.approvalTxHash && (
                <a
                  href={getExplorerUrl(nftApproval.approvalTxHash) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  title="View transaction on block explorer"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              {!nftApproval.isApproved &&
                deployVault.isSuccess &&
                canExecute &&
                !nftApproval.isLoadingApproval && (
                  <button
                    onClick={handleApprove}
                    disabled={approvalPending}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm rounded transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    {approvalPending && <Loader2 className="w-3 h-3 animate-spin" />}
                    {nftApproval.isWaitingForConfirmation
                      ? 'Confirming...'
                      : nftApproval.isApproving
                        ? 'Approving...'
                        : 'Approve'}
                  </button>
                )}
            </div>
            {nftApproval.approvalError && (
              <div className="ml-8 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-red-400 mb-1">
                      {parseTransactionError(nftApproval.approvalError).title}
                    </div>
                    <div className="text-sm text-red-300/90">
                      {parseTransactionError(nftApproval.approvalError).message}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Transfer Position to Vault */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {initVault.isSuccess ? (
                <Check className="w-5 h-5 text-green-500" />
              ) : initVault.isPending ? (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              ) : (
                <Circle className="w-5 h-5 text-slate-400" />
              )}
              <span className="text-white flex-1">Transfer Position to Vault</span>
              {initVault.result?.txHash && (
                <a
                  href={getExplorerUrl(initVault.result.txHash) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  title="View transaction on block explorer"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              {!initVault.isSuccess &&
                nftApproval.isApproved &&
                canExecute && (
                  <button
                    onClick={handleInit}
                    disabled={initPending}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white text-sm rounded transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    {initPending && <Loader2 className="w-3 h-3 animate-spin" />}
                    {initVault.isConfirming
                      ? 'Confirming...'
                      : initVault.isAwaitingSignature
                        ? 'Sign...'
                        : 'Transfer'}
                  </button>
                )}
            </div>
            {initVault.isSuccess && (
              <div className="text-xs text-green-400 ml-8">
                Position NFT transferred to vault
              </div>
            )}
            {initVault.error && (
              <div className="ml-8 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-red-400 mb-1">
                      {parseTransactionError(initVault.error).title}
                    </div>
                    <div className="text-sm text-red-300/90">
                      {parseTransactionError(initVault.error).message}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Connect wallet prompt */}
        {!isConnected && (
          <div className="mt-4 text-center">
            <span className="text-slate-400 text-sm">
              Connect your wallet to continue
            </span>
          </div>
        )}
      </div>

      {/* Summary */}
      {allStepsComplete && deployVault.result && (
        <div className="p-4 bg-green-900/20 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <Check className="w-6 h-6 text-green-500" />
            <span className="text-lg font-semibold text-green-400">
              Hedge Vault Created Successfully!
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Vault Address:</span>
              <span className="font-mono text-slate-300">
                {deployVault.result.vaultAddress.slice(0, 10)}...
                {deployVault.result.vaultAddress.slice(-8)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Position NFT:</span>
              <span className="text-slate-300">#{positionConfig.nftId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Vault Token:</span>
              <span className="text-slate-300">
                {vaultName} ({vaultSymbol})
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Finish Button */}
      {allStepsComplete && (
        <div className="flex justify-end">
          <button
            onClick={handleFinish}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            Finish
          </button>
        </div>
      )}

      {/* Notice about contract bytecode */}
      <div className="p-3 bg-amber-900/20 border border-amber-500/30 rounded-lg text-sm text-amber-300">
        <strong>Note:</strong> This wizard requires the HedgeVault contract bytecode
        to be configured. Deployment will fail until the contract is deployed and
        the bytecode is added.
      </div>
    </div>
  );
}
