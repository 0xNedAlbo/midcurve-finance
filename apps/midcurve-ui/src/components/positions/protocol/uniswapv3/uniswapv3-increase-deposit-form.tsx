'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { getTokenAmountsFromLiquidity } from '@midcurve/shared';
import { formatCompactValue } from '@/lib/fraction-format';
import type { ListPositionData } from '@midcurve/api-shared';
import type { EvmChainSlug } from '@/config/chains';
import { CHAIN_METADATA } from '@/config/chains';
import { useIncreaseLiquidity } from '@/hooks/positions/uniswapv3/useIncreaseLiquidity';
import { useUpdatePositionWithEvents } from '@/hooks/positions/uniswapv3/useUpdatePositionWithEvents';
import { parsePositionEvents } from '@/lib/uniswapv3/parse-position-events';
import { NetworkSwitchStep } from '@/components/positions/NetworkSwitchStep';
import { TransactionStep } from '@/components/positions/TransactionStep';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmAccountSwitchPrompt } from '@/components/common/EvmAccountSwitchPrompt';
import { PositionSizeConfig } from '@/components/positions/wizard/uniswapv3/position-size-config';
import { apiClient } from '@/lib/api-client';
import { useTokenApproval } from '@/hooks/positions/uniswapv3/wizard/useTokenApproval';
import type { Erc20Token, UniswapV3Pool } from '@midcurve/shared';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';
import { WalletBalanceSection } from '@/components/positions/wizard/uniswapv3/shared/wallet-balance-section';
import { InsufficientFundsAlert, type InsufficientFundsInfo } from '@/components/positions/wizard/uniswapv3/shared/insufficient-funds-alert';

interface UniswapV3IncreaseDepositFormProps {
  position: ListPositionData;
  onIncreaseSuccess?: () => void;
  onClose: () => void;
}

/**
 * Uniswap V3 Increase Deposit Form Component
 *
 * Allows users to add liquidity to their existing Uniswap V3 position.
 * Features:
 * - PositionSizeConfig component for flexible liquidity input (4 modes)
 * - Live preview of required token amounts
 * - Wallet balance validation
 * - Token approval flow
 * - Increase liquidity transaction
 * - Success/error handling
 */
export function UniswapV3IncreaseDepositForm({
  position,
  onIncreaseSuccess,
  onClose,
}: UniswapV3IncreaseDepositFormProps) {
  const [additionalLiquidity, setAdditionalLiquidity] = useState<bigint>(0n);
  const [isRefreshingPool, setIsRefreshingPool] = useState<boolean>(false);
  const [refreshedPool, setRefreshedPool] = useState<UniswapV3Pool | null>(null);

  const {
    address: walletAddress,
    isConnected,
    chainId: connectedChainId,
  } = useAccount();

  const updateMutation = useUpdatePositionWithEvents();

  // Type assertion for config (we know it's Uniswap V3)
  const config = position.config as {
    chainId: number;
    nftId: number;
    tickLower: number;
    tickUpper: number;
  };
  const state = position.state as { liquidity: string; ownerAddress: string };

  // Map chainId to chain slug
  const getChainSlugFromChainId = (chainId: number): EvmChainSlug | null => {
    const entry = Object.entries(CHAIN_METADATA).find(
      ([_, meta]) => meta.chainId === chainId
    );
    return entry ? (entry[0] as EvmChainSlug) : null;
  };

  const chain = getChainSlugFromChainId(config.chainId);
  const chainConfig = chain ? CHAIN_METADATA[chain] : null;

  // Token info for display
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  // Check if wallet is connected to the wrong network
  const isWrongNetwork = !!(
    isConnected &&
    connectedChainId !== chainConfig?.chainId
  );

  // Check if connected wallet is the position owner
  const isWrongAccount = !!(
    isConnected &&
    walletAddress &&
    state.ownerAddress &&
    walletAddress.toLowerCase() !== state.ownerAddress.toLowerCase()
  );

  // Fetch wallet balances with real-time Transfer event watching (MUST be called before any returns)
  const baseBalanceQuery = useErc20TokenBalance({
    walletAddress: walletAddress || null,
    tokenAddress: (baseToken.config as { address: Address }).address,
    chainId: config.chainId,
    enabled: isConnected && !isWrongNetwork && !isWrongAccount,
  });

  const quoteBalanceQuery = useErc20TokenBalance({
    walletAddress: walletAddress || null,
    tokenAddress: (quoteToken.config as { address: Address }).address,
    chainId: config.chainId,
    enabled: isConnected && !isWrongNetwork && !isWrongAccount,
  });

  const baseBalance = baseBalanceQuery.balanceBigInt || 0n;
  const quoteBalance = quoteBalanceQuery.balanceBigInt || 0n;

  // Use refreshed pool if available, otherwise use position's pool
  const currentPool = (refreshedPool || position.pool) as UniswapV3Pool;

  // Handle pool price refresh (MUST be called before any returns)
  const handleRefreshPool = useCallback(async () => {
    if (isRefreshingPool) return;

    setIsRefreshingPool(true);
    try {
      const poolAddress = (position.pool.config as { address: string }).address;
      const response = await apiClient<{
        data: { pool: UniswapV3Pool };
      }>(`/api/v1/pools/uniswapv3/${config.chainId}/${poolAddress}`, {
        method: 'GET',
      });

      if (response.data?.pool) {
        setRefreshedPool(response.data.pool as UniswapV3Pool);
      }
    } catch (error) {
      console.error('Error refreshing pool price:', error);
    } finally {
      setIsRefreshingPool(false);
    }
  }, [isRefreshingPool, position.pool.config, config.chainId]);

  // Refresh pool state once when modal opens (MUST be called before any returns)
  useEffect(() => {
    handleRefreshPool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array = run once on mount

  // Calculate required token amounts from additional liquidity (MUST be called before any returns)
  const requiredAmounts = useMemo(() => {
    const poolState = currentPool.state;
    const sqrtPriceX96 = BigInt(poolState.sqrtPriceX96);

    if (additionalLiquidity === 0n || sqrtPriceX96 === 0n) {
      return {
        token0Amount: 0n,
        token1Amount: 0n,
        baseAmount: 0n,
        quoteAmount: 0n,
      };
    }

    try {
      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        additionalLiquidity,
        sqrtPriceX96,
        config.tickLower,
        config.tickUpper
      );

      const isQuoteToken0 = position.isToken0Quote;
      const baseAmount = isQuoteToken0 ? token1Amount : token0Amount;
      const quoteAmount = isQuoteToken0 ? token0Amount : token1Amount;

      return {
        token0Amount,
        token1Amount,
        baseAmount,
        quoteAmount,
      };
    } catch (error) {
      console.error('Error calculating required amounts:', error);
      return {
        token0Amount: 0n,
        token1Amount: 0n,
        baseAmount: 0n,
        quoteAmount: 0n,
      };
    }
  }, [
    additionalLiquidity,
    currentPool,
    config.tickLower,
    config.tickUpper,
    position.isToken0Quote,
  ]);

  // Calculate insufficient funds (MUST be called before any returns)
  const insufficientFunds: InsufficientFundsInfo | null = useMemo(() => {
    if (!isConnected || isWrongNetwork || isWrongAccount) return null;

    const needsBase = baseBalance < requiredAmounts.baseAmount;
    const needsQuote = quoteBalance < requiredAmounts.quoteAmount;

    if (!needsBase && !needsQuote) return null;

    return {
      needsBase,
      needsQuote,
      missingBase: needsBase ? requiredAmounts.baseAmount - baseBalance : 0n,
      missingQuote: needsQuote ? requiredAmounts.quoteAmount - quoteBalance : 0n,
    };
  }, [
    isConnected,
    isWrongNetwork,
    isWrongAccount,
    baseBalance,
    quoteBalance,
    requiredAmounts.baseAmount,
    requiredAmounts.quoteAmount,
  ]);

  // Token approvals (MUST be called before any returns)
  const baseTokenApproval = useTokenApproval({
    tokenAddress: (baseToken.config as { address: Address }).address,
    ownerAddress: walletAddress ?? null,
    requiredAmount: requiredAmounts.baseAmount,
    chainId: config.chainId,
    enabled: isConnected && !isWrongNetwork && !isWrongAccount && !insufficientFunds,
  });

  const quoteTokenApproval = useTokenApproval({
    tokenAddress: (quoteToken.config as { address: Address }).address,
    ownerAddress: walletAddress ?? null,
    requiredAmount: requiredAmounts.quoteAmount,
    chainId: config.chainId,
    enabled: isConnected && !isWrongNetwork && !isWrongAccount && !insufficientFunds,
  });

  // Increase liquidity transaction
  const increaseLiquidityParams =
    additionalLiquidity > 0n &&
    baseTokenApproval.isApproved &&
    quoteTokenApproval.isApproved
      ? {
          tokenId: BigInt(config.nftId),
          amount0Desired: requiredAmounts.token0Amount,
          amount1Desired: requiredAmounts.token1Amount,
          chainId: config.chainId,
          slippageBps: 50, // 0.5% slippage
        }
      : null;

  const increaseLiquidity = useIncreaseLiquidity(increaseLiquidityParams);

  // Update position via PATCH endpoint when transaction succeeds (MUST be called before any returns)
  useEffect(() => {
    if (increaseLiquidity.isSuccess && increaseLiquidity.receipt && !updateMutation.isPending && !updateMutation.isSuccess) {
      const events = parsePositionEvents(increaseLiquidity.receipt);

      updateMutation.mutate(
        {
          chainId: config.chainId,
          nftId: config.nftId.toString(),
          events,
        },
        {
          onSuccess: () => {
            onIncreaseSuccess?.();
          },
          onError: (error) => {
            console.error('Failed to update position:', error);
          },
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    increaseLiquidity.isSuccess,
    increaseLiquidity.receipt,
    // Don't include updateMutation in dependencies to prevent infinite loop
  ]);

  // Validate chain configuration
  if (!chain || !chainConfig) {
    console.error('Invalid chain configuration for chainId:', config.chainId);
    return (
      <div className="text-center py-12">
        <p className="text-red-400">
          Invalid chain configuration: Chain ID {config.chainId}
        </p>
        <p className="text-slate-400 text-sm mt-2">
          This position cannot be modified at this time.
        </p>
      </div>
    );
  }

  // Pool data for WalletBalanceSection and InsufficientFundsAlert components
  const poolData = {
    token0: {
      address: (position.pool.token0.config as { address: string }).address,
      symbol: position.pool.token0.symbol,
      decimals: position.pool.token0.decimals,
    },
    token1: {
      address: (position.pool.token1.config as { address: string }).address,
      symbol: position.pool.token1.symbol,
      decimals: position.pool.token1.decimals,
    },
  };

  // Wallet connection prompt
  if (!isConnected) {
    return <EvmWalletConnectionPrompt />;
  }

  // Wrong account prompt
  if (isWrongAccount && state.ownerAddress) {
    return (
      <EvmAccountSwitchPrompt>
        <p className="text-sm text-slate-400">
          Position Owner: {state.ownerAddress.slice(0, 6)}...
          {state.ownerAddress.slice(-4)}
        </p>
      </EvmAccountSwitchPrompt>
    );
  }

  return (
    <div className="space-y-3">
      {/* Position Size Configuration */}
      <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
        <PositionSizeConfig
          pool={currentPool}
          baseToken={baseToken as unknown as Erc20Token}
          quoteToken={quoteToken as unknown as Erc20Token}
          tickLower={config.tickLower}
          tickUpper={config.tickUpper}
          liquidity={additionalLiquidity}
          onLiquidityChange={setAdditionalLiquidity}
          initialMode="matched"
          chain={chain}
          onRefreshPool={handleRefreshPool}
          label="Additional Deposit:"
        />
      </div>

      {/* Wallet Balance Section */}
      <WalletBalanceSection
        pool={poolData}
        baseTokenAddress={(baseToken.config as { address: string }).address}
        quoteTokenAddress={(quoteToken.config as { address: string }).address}
        baseBalance={baseBalance}
        quoteBalance={quoteBalance}
        baseBalanceLoading={baseBalanceQuery.isLoading}
        quoteBalanceLoading={quoteBalanceQuery.isLoading}
        isConnected={isConnected}
        isWrongNetwork={isWrongNetwork}
        chain={chain}
      />

      {/* Insufficient Funds Alert with CowSwap Widget */}
      {insufficientFunds && (
        <InsufficientFundsAlert
          insufficientFunds={insufficientFunds}
          pool={poolData}
          baseTokenAddress={(baseToken.config as { address: string }).address}
          quoteTokenAddress={(quoteToken.config as { address: string }).address}
          isConnected={isConnected}
          chain={chain}
        />
      )}

      {/* Network Switch */}
      <NetworkSwitchStep chain={chain} isWrongNetwork={isWrongNetwork} />

      {/* Transaction Steps */}
      <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Transaction</h3>
        <div className="space-y-3">

        {/* Base Token Approval */}
        {requiredAmounts.baseAmount > 0n && (
          <TransactionStep
            title={`Approve ${baseToken.symbol}`}
            description={`Allow spending ${formatCompactValue(
              requiredAmounts.baseAmount,
              baseToken.decimals
            )} ${baseToken.symbol}`}
            isLoading={baseTokenApproval.isApproving}
            isComplete={baseTokenApproval.isApproved}
            isDisabled={
              isWrongNetwork ||
              additionalLiquidity === 0n ||
              !!insufficientFunds ||
              baseTokenApproval.isApproved
            }
            onExecute={() => baseTokenApproval.approve()}
            showExecute={!baseTokenApproval.isApproved}
          />
        )}

        {/* Quote Token Approval */}
        {requiredAmounts.quoteAmount > 0n && (
          <TransactionStep
            title={`Approve ${quoteToken.symbol}`}
            description={`Allow spending ${formatCompactValue(
              requiredAmounts.quoteAmount,
              quoteToken.decimals
            )} ${quoteToken.symbol}`}
            isLoading={quoteTokenApproval.isApproving}
            isComplete={quoteTokenApproval.isApproved}
            isDisabled={
              isWrongNetwork ||
              additionalLiquidity === 0n ||
              !!insufficientFunds ||
              quoteTokenApproval.isApproved
            }
            onExecute={() => quoteTokenApproval.approve()}
            showExecute={!quoteTokenApproval.isApproved}
          />
        )}

        {/* Increase Liquidity Transaction */}
        <TransactionStep
          title="Increase Liquidity"
          description="Add liquidity to your position"
          isLoading={
            increaseLiquidity.isIncreasing ||
            increaseLiquidity.isWaitingForConfirmation
          }
          isComplete={increaseLiquidity.isSuccess}
          isDisabled={
            isWrongNetwork ||
            additionalLiquidity === 0n ||
            !!insufficientFunds ||
            !baseTokenApproval.isApproved ||
            !quoteTokenApproval.isApproved ||
            increaseLiquidity.isSuccess
          }
          onExecute={() => increaseLiquidity.increase()}
          showExecute={!increaseLiquidity.isSuccess}
          transactionHash={increaseLiquidity.receipt?.transactionHash}
          chain={chain}
        />

        {/* Update Position (Backend) */}
        {increaseLiquidity.isSuccess && (
          <TransactionStep
            title="Update Position"
            description="Updating position data..."
            isLoading={updateMutation.isPending}
            isComplete={updateMutation.isSuccess}
            isDisabled={true}
            onExecute={() => {}}
            showExecute={false}
          />
        )}
        </div>
      </div>

      {/* Approval Errors */}
      {baseTokenApproval.approvalError && (
        <div className="bg-red-900/20 border border-red-600/50 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-200 font-medium">
                {baseToken.symbol} Approval Failed
              </p>
              <p className="text-red-300/80 text-sm mt-1">
                {baseTokenApproval.approvalError.message}
              </p>
            </div>
          </div>
        </div>
      )}

      {quoteTokenApproval.approvalError && (
        <div className="bg-red-900/20 border border-red-600/50 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-200 font-medium">
                {quoteToken.symbol} Approval Failed
              </p>
              <p className="text-red-300/80 text-sm mt-1">
                {quoteTokenApproval.approvalError.message}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {(increaseLiquidity.increaseError || updateMutation.isError) && (
        <div className="bg-red-900/20 border border-red-600/50 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-200 font-medium">Transaction Failed</p>
              <p className="text-red-300/80 text-sm mt-1">
                {increaseLiquidity.increaseError?.message ||
                  'Failed to update position data. Please try again.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Finish Button - Small green button at bottom right, only shown after position update completes */}
      {updateMutation.isSuccess && (
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            Finish
          </button>
        </div>
      )}
    </div>
  );
}
