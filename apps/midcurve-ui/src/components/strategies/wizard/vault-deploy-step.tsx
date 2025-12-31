"use client";

import { useState, useMemo } from "react";
import {
  Loader2,
  XCircle,
  Vault,
  AlertCircle,
} from "lucide-react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import type { Address } from "viem";

import { usePrepareVaultDeployment } from "@/hooks/strategies/usePrepareVaultDeployment";
import { useDeployVault } from "@/hooks/strategies/useDeployVault";
import { useRegisterVault } from "@/hooks/strategies/useRegisterVault";
import { getChainMetadataByChainId } from "@/config/chains";

interface VaultDeployStepProps {
  /** Strategy ID to get vault params for */
  strategyId: string;
  /** Strategy contract address (for registration) */
  strategyAddress: string;
  /** Callback when vault is deployed and registered (auto-advance to next step) */
  onVaultDeployed: (vaultAddress: string) => void;
}

export function VaultDeployStep({
  strategyId,
  strategyAddress,
  onVaultDeployed,
}: VaultDeployStepProps) {
  const { address: userAddress, isConnected, status } = useAccount();
  const currentChainId = useChainId();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  // More robust check: wallet is ready when connected AND has address
  // This handles edge cases where isConnected might be true but address is undefined
  const isWalletReady = status === 'connected' && isConnected && !!userAddress;

  // State for registration after deployment
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  // Fetch vault deployment params
  const {
    data: vaultParams,
    isLoading: isLoadingParams,
    error: paramsError,
  } = usePrepareVaultDeployment(strategyId, {
    enabled: !!strategyId,
  });

  // Vault deployment hook
  const {
    deploy,
    reset: resetDeploy,
    status: deployStatus,
    error: deployError,
    result: deployResult,
    isPending: isDeployPending,
  } = useDeployVault();

  // Vault registration mutation
  const registerVault = useRegisterVault();

  // Check if user is on correct chain
  const isWrongChain = vaultParams && currentChainId !== vaultParams.vaultChainId;

  // Get human-readable chain name
  const chainName = useMemo(() => {
    if (!vaultParams) return "";
    const meta = getChainMetadataByChainId(vaultParams.vaultChainId);
    return meta?.shortName || `Chain ${vaultParams.vaultChainId}`;
  }, [vaultParams]);

  // Handle chain switch
  const handleSwitchChain = async () => {
    if (!vaultParams) return;
    try {
      await switchChainAsync({ chainId: vaultParams.vaultChainId });
    } catch (error) {
      console.error("Failed to switch chain:", error);
    }
  };

  // Handle deploy
  const handleDeploy = async () => {
    if (!vaultParams || !userAddress) return;

    try {
      const result = await deploy({
        chainId: vaultParams.vaultChainId,
        bytecode: vaultParams.bytecode as `0x${string}`,
        constructorParams: {
          owner: vaultParams.constructorParams.owner as Address,
          operator: vaultParams.constructorParams.operator as Address,
          token: vaultParams.constructorParams.token as Address,
        },
      });

      // After successful deployment, register the vault
      setIsRegistering(true);
      setRegistrationError(null);

      await registerVault.mutateAsync({
        strategyAddress,
        request: {
          vaultAddress: result.vaultAddress,
          chainId: vaultParams.vaultChainId,
          deployTxHash: result.deployTxHash,
        },
      });

      setIsRegistering(false);
      onVaultDeployed(result.vaultAddress);
    } catch (error) {
      console.error("Vault deployment/registration failed:", error);
      if (isRegistering) {
        setRegistrationError(
          error instanceof Error ? error.message : "Registration failed"
        );
        setIsRegistering(false);
      }
    }
  };

  // Handle retry
  const handleRetry = () => {
    resetDeploy();
    setRegistrationError(null);
    setIsRegistering(false);
  };

  // Loading params state
  if (isLoadingParams) {
    return (
      <div className="space-y-6">
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-6 text-center">
          <Loader2 className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-spin" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Loading Vault Parameters
          </h3>
          <p className="text-slate-300">
            Fetching deployment information...
          </p>
        </div>
      </div>
    );
  }

  // Error loading params
  if (paramsError || !vaultParams) {
    return (
      <div className="space-y-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Failed to Load Vault Parameters
          </h3>
          <p className="text-slate-300 mb-4">
            {paramsError?.message || "Could not fetch vault deployment information"}
          </p>
        </div>
      </div>
    );
  }

  // Error state (deployment or registration failed)
  const errorMessage =
    deployError?.message || registrationError;

  if (errorMessage && deployStatus === "error") {
    return (
      <div className="space-y-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Vault Deployment Failed
          </h3>
          <p className="text-slate-300 mb-4">{errorMessage}</p>
          <button
            onClick={handleRetry}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Registration error (deployment succeeded but registration failed)
  if (registrationError && deployResult) {
    return (
      <div className="space-y-6">
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-6 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Vault Deployed, Registration Failed
          </h3>
          <p className="text-slate-300 mb-2">
            Your vault was deployed successfully, but registration failed.
          </p>
          <p className="text-slate-400 text-sm mb-4">{registrationError}</p>
          <button
            onClick={async () => {
              setIsRegistering(true);
              setRegistrationError(null);
              try {
                await registerVault.mutateAsync({
                  strategyAddress,
                  request: {
                    vaultAddress: deployResult.vaultAddress,
                    chainId: vaultParams.vaultChainId,
                    deployTxHash: deployResult.deployTxHash,
                  },
                });
                setIsRegistering(false);
                onVaultDeployed(deployResult.vaultAddress);
              } catch (error) {
                setRegistrationError(
                  error instanceof Error ? error.message : "Registration failed"
                );
                setIsRegistering(false);
              }
            }}
            disabled={isRegistering}
            className="px-6 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 text-white rounded-lg transition-colors font-medium cursor-pointer"
          >
            {isRegistering ? "Registering..." : "Retry Registration"}
          </button>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
          <label className="block text-xs text-slate-400 mb-1">
            Vault Address (save this!)
          </label>
          <code className="block text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
            {deployResult.vaultAddress}
          </code>
        </div>
      </div>
    );
  }

  // Deploying/Registering state
  if (isDeployPending || isRegistering) {
    const statusLabel = isRegistering
      ? "Registering vault with backend..."
      : deployStatus === "switching_chain"
        ? "Switching network..."
        : deployStatus === "awaiting_signature"
          ? "Waiting for signature..."
          : deployStatus === "confirming"
            ? "Confirming transaction..."
            : "Deploying vault...";

    return (
      <div className="space-y-6">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-6 text-center">
          <div className="relative w-16 h-16 mx-auto mb-4">
            <Vault className="w-16 h-16 text-blue-400/30" />
            <Loader2 className="w-8 h-8 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">
            {isRegistering ? "Registering Vault" : "Deploying Vault"}
          </h3>
          <p className="text-slate-300">{statusLabel}</p>
        </div>
      </div>
    );
  }

  // Pre-deploy state - show vault info and deploy button
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Vault className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-slate-300 text-sm">
              Deploy your funding vault on the public chain. This vault will hold
              your strategy's funds and ETH for gas.{" "}
              <span className="text-white font-medium">You will sign a transaction.</span>
            </p>
          </div>
        </div>
      </div>

      {/* Vault Details */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg divide-y divide-slate-700/50">
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Chain</span>
            <span className="text-white">{chainName}</span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Vault Token</span>
            <span className="text-white">
              {vaultParams.vaultToken.symbol} ({vaultParams.vaultToken.decimals} decimals)
            </span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex flex-col gap-1">
            <span className="text-slate-400 text-sm">Token Address</span>
            <code className="text-white font-mono text-xs bg-slate-700/50 px-2 py-1 rounded truncate">
              {vaultParams.vaultToken.address}
            </code>
          </div>
        </div>
        <div className="p-4">
          <div className="flex flex-col gap-1">
            <span className="text-slate-400 text-sm">Vault Owner (You)</span>
            <code className="text-white font-mono text-xs bg-slate-700/50 px-2 py-1 rounded truncate">
              {vaultParams.constructorParams.owner}
            </code>
          </div>
        </div>
        <div className="p-4">
          <div className="flex flex-col gap-1">
            <span className="text-slate-400 text-sm">Vault Operator (Automation Wallet)</span>
            <code className="text-white font-mono text-xs bg-slate-700/50 px-2 py-1 rounded truncate">
              {vaultParams.constructorParams.operator}
            </code>
          </div>
        </div>
      </div>

      {/* Wrong Chain Warning */}
      {isWrongChain && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-yellow-200 text-sm font-medium mb-2">
                Wrong Network
              </p>
              <p className="text-slate-300 text-sm mb-3">
                Please switch to {chainName} to deploy the vault.
              </p>
              <button
                onClick={handleSwitchChain}
                disabled={isSwitchingChain}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 text-white text-sm rounded-lg transition-colors cursor-pointer"
              >
                {isSwitchingChain ? "Switching..." : `Switch to ${chainName}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Not Connected Warning */}
      {!isWalletReady && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-red-200 text-sm">
              {status === 'connecting' || status === 'reconnecting'
                ? 'Connecting wallet...'
                : 'Please connect your wallet to deploy the vault.'}
            </p>
          </div>
        </div>
      )}

      {/* Deploy Button */}
      <div className="flex justify-center">
        <button
          onClick={handleDeploy}
          disabled={!isWalletReady || isWrongChain}
          className="flex items-center gap-2 px-8 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium cursor-pointer"
        >
          <Vault className="w-5 h-5" />
          Deploy Vault
        </button>
      </div>
    </div>
  );
}
