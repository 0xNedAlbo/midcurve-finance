'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { formatUnits } from 'viem';
import { getTokenAmountsFromLiquidity } from '@midcurve/shared';
import { formatCompactValue } from '@/lib/fraction-format';
import type { ListPositionData } from '@midcurve/api-shared';
import type { EvmChainSlug } from '@/config/chains';
import { CHAIN_METADATA } from '@/config/chains';
import { useDecreaseLiquidity } from '@/hooks/positions/uniswapv3/useDecreaseLiquidity';
import { useUpdatePositionWithEvents } from '@/hooks/positions/uniswapv3/useUpdatePositionWithEvents';
import { parsePositionEvents } from '@/lib/uniswapv3/parse-position-events';
import { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from '@/config/contracts/nonfungible-position-manager';
import { NetworkSwitchStep } from '@/components/positions/NetworkSwitchStep';
import { TransactionStep } from '@/components/positions/TransactionStep';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmAccountSwitchPrompt } from '@/components/common/EvmAccountSwitchPrompt';
import { apiClient } from '@/lib/api-client';

interface UniswapV3WithdrawFormProps {
  position: ListPositionData;
  onClose: () => void;
  onWithdrawSuccess?: () => void;
}

/**
 * Uniswap V3 Withdraw Form Component
 *
 * Allows users to withdraw liquidity from their Uniswap V3 position.
 * Features:
 * - Percentage slider + quote value input (synchronized)
 * - Live preview of tokens to receive
 * - Network validation
 * - Atomic multicall transaction (decrease + collect)
 * - Success/error handling
 */
export function UniswapV3WithdrawForm({
  position,
  onClose,
  onWithdrawSuccess,
}: UniswapV3WithdrawFormProps) {
  const [withdrawPercent, setWithdrawPercent] = useState<number>(0);
  const [quoteValueInput, setQuoteValueInput] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshedSqrtPriceX96, setRefreshedSqrtPriceX96] = useState<string | null>(null);

  const {
    address: walletAddress,
    isConnected,
    chainId: connectedChainId,
  } = useAccount();

  const updateMutation = useUpdatePositionWithEvents();

  // Type assertion for config (we know it's Uniswap V3)
  const config = position.config as { chainId: number; nftId: number; tickLower: number; tickUpper: number };
  const state = position.state as { liquidity: string; ownerAddress: string };
  const poolState = position.pool.state as { sqrtPriceX96: string };

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
  const baseToken = position.isToken0Quote ? position.pool.token1 : position.pool.token0;
  const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;

  // Use refreshed pool price if available, otherwise use position's pool state
  const currentSqrtPriceX96 = refreshedSqrtPriceX96 || poolState.sqrtPriceX96;

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

  // Handle pool price refresh (MUST be called before any returns)
  const handleRefreshPool = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      const poolAddress = (position.pool.config as { address: string }).address;
      const response = await apiClient<{ data: { pool: { state: { sqrtPriceX96: string } } } }>(
        `/api/v1/pools/uniswapv3/${config.chainId}/${poolAddress}`,
        { method: 'GET' }
      );

      if (response.data?.pool?.state?.sqrtPriceX96) {
        setRefreshedSqrtPriceX96(response.data.pool.state.sqrtPriceX96);
      }
    } catch (error) {
      console.error('Error refreshing pool price:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, position.pool.config, config.chainId]);

  // Calculate current position value in quote tokens from liquidity
  const currentPositionValue = useMemo(() => {
    const liquidity = BigInt(state.liquidity || '0');
    const sqrtPriceX96 = BigInt(currentSqrtPriceX96 || '0');

    if (liquidity === 0n || sqrtPriceX96 === 0n) {
      return 0n;
    }

    try {
      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        config.tickLower,
        config.tickUpper
      );

      const isQuoteToken0 = position.isToken0Quote;
      const baseTokenAmount = isQuoteToken0 ? token1Amount : token0Amount;
      const quoteTokenAmount = isQuoteToken0 ? token0Amount : token1Amount;

      // Calculate position value in quote token units
      let positionValueInQuote: bigint = quoteTokenAmount;

      if (baseTokenAmount > 0n) {
        const sqrtP2 = sqrtPriceX96 * sqrtPriceX96;
        const Q192 = 1n << 192n;

        if (isQuoteToken0) {
          // quote=token0, base=token1 -> convert base to quote
          const baseAsQuote = (baseTokenAmount * Q192) / sqrtP2;
          positionValueInQuote += baseAsQuote;
        } else {
          // quote=token1, base=token0 -> convert base to quote
          const baseAsQuote = (baseTokenAmount * sqrtP2) / Q192;
          positionValueInQuote += baseAsQuote;
        }
      }

      return positionValueInQuote;
    } catch (error) {
      console.error('Error calculating current position value:', error);
      return 0n;
    }
  }, [state.liquidity, currentSqrtPriceX96, config.tickLower, config.tickUpper, position.isToken0Quote]);

  // Calculate liquidity to remove based on percentage
  const liquidityToRemove = useMemo(() => {
    const currentLiquidity = BigInt(state.liquidity || '0');
    const percentScaled = Math.floor(withdrawPercent * 100); // Convert to basis points
    return (currentLiquidity * BigInt(percentScaled)) / 10000n;
  }, [state.liquidity, withdrawPercent]);

  // Calculate token amounts that will be received
  const withdrawAmounts = useMemo(() => {
    const sqrtPriceX96 = BigInt(currentSqrtPriceX96 || '0');

    if (liquidityToRemove === 0n || sqrtPriceX96 === 0n) {
      return { baseAmount: 0n, quoteAmount: 0n };
    }

    try {
      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidityToRemove,
        sqrtPriceX96,
        config.tickLower,
        config.tickUpper
      );

      const isQuoteToken0 = position.isToken0Quote;
      const baseAmount = isQuoteToken0 ? token1Amount : token0Amount;
      const quoteAmount = isQuoteToken0 ? token0Amount : token1Amount;

      return { baseAmount, quoteAmount };
    } catch (error) {
      console.error('Error calculating withdraw amounts:', error);
      return { baseAmount: 0n, quoteAmount: 0n };
    }
  }, [liquidityToRemove, currentSqrtPriceX96, config.tickLower, config.tickUpper, position.isToken0Quote]);

  // Calculate minimum amounts with slippage (1% = 100 bps)
  const amount0Min = useMemo(() => {
    const isQuoteToken0 = position.isToken0Quote;
    const amount = isQuoteToken0 ? withdrawAmounts.quoteAmount : withdrawAmounts.baseAmount;
    return (amount * 9900n) / 10000n; // 1% slippage
  }, [position.isToken0Quote, withdrawAmounts]);

  const amount1Min = useMemo(() => {
    const isQuoteToken0 = position.isToken0Quote;
    const amount = isQuoteToken0 ? withdrawAmounts.baseAmount : withdrawAmounts.quoteAmount;
    return (amount * 9900n) / 10000n; // 1% slippage
  }, [position.isToken0Quote, withdrawAmounts]);

  // Prepare decrease liquidity parameters
  const decreaseParams = useMemo(() => {
    if (!walletAddress || liquidityToRemove === 0n) {
      return null;
    }

    return {
      tokenId: BigInt(config.nftId),
      liquidity: liquidityToRemove,
      amount0Min,
      amount1Min,
      chainId: config.chainId,
      recipient: walletAddress as Address,
      slippageBps: 100, // 1% slippage
    };
  }, [walletAddress, liquidityToRemove, amount0Min, amount1Min, config.chainId, config.nftId]);

  // Decrease liquidity hook
  const decreaseLiquidity = useDecreaseLiquidity(decreaseParams);

  // Reset state when form opens
  useEffect(() => {
    updateMutation.reset();
    decreaseLiquidity.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Auto-refresh pool price when modal opens
  useEffect(() => {
    handleRefreshPool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Handle percentage slider change
  const handlePercentChange = useCallback(
    (percent: number) => {
      setWithdrawPercent(percent);
      const percentScaled = Math.floor(percent * 100);
      const quoteValue = (currentPositionValue * BigInt(percentScaled)) / 10000n;
      const formattedValue = formatUnits(quoteValue, quoteToken.decimals);
      setQuoteValueInput(formattedValue);
    },
    [currentPositionValue, quoteToken.decimals]
  );

  // Handle quote value input change
  const handleQuoteValueChange = useCallback(
    (value: string) => {
      setQuoteValueInput(value);

      try {
        const parsedValue = parseFloat(value);
        if (isNaN(parsedValue) || parsedValue <= 0) {
          setWithdrawPercent(0);
          return;
        }

        const valueInSmallestUnit = BigInt(
          Math.floor(parsedValue * Math.pow(10, quoteToken.decimals))
        );

        if (currentPositionValue > 0n) {
          const percent =
            Number((valueInSmallestUnit * 10000n) / currentPositionValue) / 100;
          setWithdrawPercent(Math.min(100, Math.max(0, percent)));
        }
      } catch {
        // Invalid input, keep current percentage
      }
    },
    [currentPositionValue, quoteToken.decimals]
  );

  // Handle withdraw execution
  const handleWithdraw = useCallback(() => {
    decreaseLiquidity.withdraw();
  }, [decreaseLiquidity]);

  // Handle successful withdrawal - seed events via PATCH endpoint (MUST be called before any returns)
  useEffect(() => {
    if (
      decreaseLiquidity.isSuccess &&
      decreaseLiquidity.receipt &&
      !updateMutation.isPending &&
      !updateMutation.isSuccess
    ) {
      const nftManagerAddress = NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[config.chainId];

      if (!nftManagerAddress) {
        console.error('NFT Manager address not found for chain');
        return;
      }

      // Parse all events from multicall receipt (automatically extracts DECREASE_LIQUIDITY and COLLECT)
      const events = parsePositionEvents(decreaseLiquidity.receipt);

      if (events.length > 0) {
        updateMutation.mutate(
          {
            chainId: config.chainId,
            nftId: config.nftId.toString(),
            events,
          },
          {
            onSuccess: () => {
              // Trigger success callback when position update completes
              onWithdrawSuccess?.();
            },
          }
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    decreaseLiquidity.isSuccess,
    decreaseLiquidity.receipt,
    config.chainId,
    config.nftId,
    onWithdrawSuccess,
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
          This position cannot be withdrawn at this time.
        </p>
      </div>
    );
  }

  // Validation
  const canWithdraw =
    withdrawPercent > 0 &&
    withdrawPercent <= 100 &&
    isConnected &&
    !isWrongNetwork &&
    !isWrongAccount;

  return (
    <div className="space-y-3">
      {/* Withdrawal Amount Input */}
      <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white font-medium">
            Withdrawal Amount ({quoteToken.symbol})
          </span>
        </div>
        <input
          type="text"
          value={quoteValueInput}
          onChange={(e) => handleQuoteValueChange(e.target.value)}
          placeholder="0.0"
          className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:border-blue-500 transition-colors"
        />

        {/* Percentage Slider */}
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={withdrawPercent}
          onChange={(e) => handlePercentChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                     [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
        />

        {/* Maximum and Percentage display */}
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            Maximum:{' '}
            {formatCompactValue(currentPositionValue, quoteToken.decimals)}{' '}
            {quoteToken.symbol}
          </span>
          <span>{withdrawPercent.toFixed(1)}%</span>
        </div>
      </div>

      {/* Preview Section */}
      <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white font-medium">You will receive:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefreshPool}
              disabled={isRefreshing}
              className="p-1 hover:bg-slate-700 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh pool price"
            >
              <RefreshCw
                className={`w-4 h-4 text-slate-400 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </button>
            <span className="text-white font-medium">
              {withdrawPercent > 0
                ? `${formatCompactValue(withdrawAmounts.baseAmount, baseToken.decimals)} ${baseToken.symbol} + ${formatCompactValue(withdrawAmounts.quoteAmount, quoteToken.decimals)} ${quoteToken.symbol}`
                : `0 ${baseToken.symbol} + 0 ${quoteToken.symbol}`}
            </span>
          </div>
        </div>
      </div>

      {/* Wallet Connection Section */}
      {!isConnected && <EvmWalletConnectionPrompt />}

      {/* Account Switch Section */}
      {isConnected && isWrongAccount && state.ownerAddress && (
        <EvmAccountSwitchPrompt>
          <p className="text-sm text-slate-400">
            Position Owner: {state.ownerAddress.slice(0, 6)}...{state.ownerAddress.slice(-4)}
          </p>
        </EvmAccountSwitchPrompt>
      )}

      {/* Network Switch */}
      {isConnected && !isWrongAccount && (
        <NetworkSwitchStep chain={chain} isWrongNetwork={isWrongNetwork} />
      )}

      {/* Transaction Steps */}
      {isConnected && !isWrongAccount && (
        <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Transaction</h3>
        <div className="space-y-3">

          {/* Withdraw (Multicall: Decrease + Collect) */}
          <TransactionStep
            title="Withdraw Liquidity"
            description="Remove liquidity and collect tokens in one transaction"
            isLoading={
              decreaseLiquidity.isWithdrawing ||
              decreaseLiquidity.isWaitingForWithdraw
            }
            isComplete={decreaseLiquidity.withdrawSuccess}
            isDisabled={!canWithdraw}
            onExecute={handleWithdraw}
            showExecute={!decreaseLiquidity.withdrawSuccess}
            transactionHash={decreaseLiquidity.receipt?.transactionHash}
            chain={chain}
          />

          {/* Update Position (Backend) */}
          {decreaseLiquidity.isSuccess && (
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

        {/* Error Display */}
        {decreaseLiquidity.withdrawError && (
          <div className="mt-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <div>
                <h5 className="text-red-400 font-medium">Transaction Error</h5>
                <p className="text-red-200/80 text-sm mt-1">
                  {decreaseLiquidity.withdrawError.message}
                </p>
              </div>
            </div>
          </div>
        )}
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
