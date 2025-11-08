'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccount, useChainId } from 'wagmi';
import type { Address } from 'viem';
import { getAddress } from 'viem';
import type { EvmChainSlug } from '@/config/chains';
import type { PoolDiscoveryResult } from '@midcurve/shared';
import { getTokenAmountsFromLiquidity, getTokenMapping } from '@midcurve/shared';
import type { TokenSearchResult } from '@/hooks/positions/uniswapv3/wizard/useTokenSearch';
import { useTokenApproval } from '@/hooks/positions/uniswapv3/wizard/useTokenApproval';
import { useMintPosition } from '@/hooks/positions/uniswapv3/wizard/useMintPosition';
import { useCreatePositionAPI } from '@/hooks/positions/uniswapv3/wizard/useCreatePositionAPI';
import { usePoolPrice } from '@/hooks/pools/usePoolPrice';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';
import { WalletBalanceSection } from './shared/wallet-balance-section';
import {
  InsufficientFundsAlert,
  type InsufficientFundsInfo,
} from './shared/insufficient-funds-alert';
import { TransactionStepsList } from './shared/transaction-steps-list';
import { PositionSizeConfig } from './position-size-config';
import { CHAIN_METADATA } from '@/config/chains';

interface OpenPositionStepProps {
  chain: EvmChainSlug;
  baseToken: TokenSearchResult;
  quoteToken: TokenSearchResult;
  pool: PoolDiscoveryResult<'uniswapv3'>;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  onLiquidityChange: (liquidity: bigint) => void;
  onPositionCreated: (position: any) => void;
  onValidationChange: (isValid: boolean) => void;
}

/**
 * Step 5: Open Position
 *
 * Final wizard step that handles:
 * 1. Position summary display
 * 2. Wallet balance validation with CowSwap top-up option
 * 3. Three-phase transaction execution (approve base, approve quote, mint)
 * 4. Database position creation via API
 * 5. Success state and navigation
 */
export function OpenPositionStep({
  chain,
  baseToken,
  quoteToken,
  pool,
  tickLower,
  tickUpper,
  liquidity,
  onLiquidityChange,
  onPositionCreated,
  onValidationChange,
}: OpenPositionStepProps) {
  const { address: userAddress, isConnected } = useAccount();
  const connectedChainId = useChainId();
  const chainConfig = CHAIN_METADATA[chain];
  const expectedChainId = chainConfig.chainId;

  // Check if on wrong network
  const isWrongNetwork = isConnected && connectedChainId !== expectedChainId;

  // Local pool state to manage pool with updated prices
  const [localPool, setLocalPool] = useState<PoolDiscoveryResult<'uniswapv3'>>(pool);

  // Fetch latest pool price (with refresh capability)
  const {
    sqrtPriceX96: latestSqrtPriceX96,
    currentTick: latestCurrentTick,
    refetch: refetchPoolPrice,
  } = usePoolPrice({
    chainId: pool.pool.config.chainId.toString(),
    poolAddress: pool.pool.config.address,
    enabled: true,
  });

  // Update pool state when fresh price data arrives
  useEffect(() => {
    if (latestSqrtPriceX96 && latestCurrentTick !== undefined) {
      setLocalPool((prevPool) => ({
        ...prevPool,
        pool: {
          ...prevPool.pool,
          state: {
            ...prevPool.pool.state,
            sqrtPriceX96: BigInt(latestSqrtPriceX96),
            currentTick: latestCurrentTick,
          },
        },
      }));
    }
  }, [latestSqrtPriceX96, latestCurrentTick]);

  // Calculate required token amounts from liquidity
  const { token0Amount, token1Amount} = useMemo(() => {
    return getTokenAmountsFromLiquidity(
      liquidity,
      BigInt(localPool.pool.state.sqrtPriceX96),
      tickLower,
      tickUpper,
      false // roundUp = false for floor amounts
    );
  }, [liquidity, localPool.pool.state.sqrtPriceX96, tickLower, tickUpper]);

  // Map token0/token1 to base/quote
  const tokenMapping = useMemo(() => {
    return getTokenMapping(
      localPool.pool.token0.config.address,
      localPool.pool.token1.config.address,
      baseToken.address,
      quoteToken.address
    );
  }, [localPool.pool.token0.config.address, localPool.pool.token1.config.address, baseToken.address, quoteToken.address]);

  const requiredBaseAmount = tokenMapping.baseIsToken0
    ? token0Amount
    : token1Amount;
  const requiredQuoteAmount = tokenMapping.baseIsToken0
    ? token1Amount
    : token0Amount;

  // Fetch wallet balances with real-time Transfer event watching (singleton)
  const baseBalanceQuery = useErc20TokenBalance({
    walletAddress: userAddress || null,
    tokenAddress: baseToken.address,
    chainId: expectedChainId,
    enabled: isConnected && !isWrongNetwork,
  });

  const quoteBalanceQuery = useErc20TokenBalance({
    walletAddress: userAddress || null,
    tokenAddress: quoteToken.address,
    chainId: expectedChainId,
    enabled: isConnected && !isWrongNetwork,
  });

  const baseBalance = baseBalanceQuery.balanceBigInt || 0n;
  const quoteBalance = quoteBalanceQuery.balanceBigInt || 0n;

  // Check for insufficient funds
  const insufficientFunds: InsufficientFundsInfo | null = useMemo(() => {
    if (!isConnected || isWrongNetwork) return null;

    const needsBase = baseBalance < requiredBaseAmount;
    const needsQuote = quoteBalance < requiredQuoteAmount;

    if (!needsBase && !needsQuote) return null;

    return {
      needsBase,
      needsQuote,
      missingBase: needsBase ? requiredBaseAmount - baseBalance : 0n,
      missingQuote: needsQuote ? requiredQuoteAmount - quoteBalance : 0n,
    };
  }, [
    isConnected,
    isWrongNetwork,
    baseBalance,
    quoteBalance,
    requiredBaseAmount,
    requiredQuoteAmount,
  ]);

  // Token approval hooks (with EIP-55 checksumming)
  const baseApproval = useTokenApproval({
    tokenAddress: getAddress(baseToken.address) as Address,
    ownerAddress: userAddress ?? null,
    requiredAmount: requiredBaseAmount,
    chainId: expectedChainId,
    enabled:
      isConnected && !isWrongNetwork && requiredBaseAmount > 0n && !insufficientFunds,
  });

  const quoteApproval = useTokenApproval({
    tokenAddress: getAddress(quoteToken.address) as Address,
    ownerAddress: userAddress ?? null,
    requiredAmount: requiredQuoteAmount,
    chainId: expectedChainId,
    enabled:
      isConnected &&
      !isWrongNetwork &&
      requiredQuoteAmount > 0n &&
      !insufficientFunds,
  });

  // Mint position hook
  const mintParams = useMemo(() => {
    if (
      !userAddress ||
      !isConnected ||
      isWrongNetwork ||
      insufficientFunds ||
      (requiredBaseAmount > 0n && !baseApproval.isApproved) ||
      (requiredQuoteAmount > 0n && !quoteApproval.isApproved)
    ) {
      return null;
    }

    return {
      token0: pool.pool.token0.config.address as Address,
      token1: pool.pool.token1.config.address as Address,
      fee: pool.pool.config.feeBps,
      tickLower,
      tickUpper,
      amount0Desired: token0Amount,
      amount1Desired: token1Amount,
      tickSpacing: pool.pool.config.tickSpacing,
      recipient: userAddress,
      chainId: expectedChainId,
      slippageBps: 50, // 0.5% slippage
    };
  }, [
    userAddress,
    isConnected,
    isWrongNetwork,
    insufficientFunds,
    requiredBaseAmount,
    requiredQuoteAmount,
    baseApproval.isApproved,
    quoteApproval.isApproved,
    pool,
    tickLower,
    tickUpper,
    token0Amount,
    token1Amount,
    expectedChainId,
  ]);

  const mintPosition = useMintPosition(mintParams);

  // API hook for creating position in database
  const createPositionAPI = useCreatePositionAPI();

  // Trigger API call after successful mint
  useEffect(() => {
    if (
      mintPosition.isSuccess &&
      mintPosition.tokenId &&
      mintPosition.receipt &&
      userAddress &&
      !createPositionAPI.isPending &&
      !createPositionAPI.isSuccess
    ) {
      createPositionAPI.mutate({
        chainId: chain,
        nftId: mintPosition.tokenId.toString(),
        poolAddress: pool.pool.config.address as Address,
        tickLower,
        tickUpper,
        ownerAddress: userAddress,
        quoteTokenAddress: quoteToken.address as Address,
        receipt: mintPosition.receipt,
      });
    }
  }, [
    mintPosition.isSuccess,
    mintPosition.tokenId,
    mintPosition.receipt,
    userAddress,
    createPositionAPI.isPending,
    createPositionAPI.isSuccess,
    chain,
    pool.pool.config.address,
    tickLower,
    tickUpper,
    quoteToken.address,
    createPositionAPI,
  ]);

  // Notify parent when position is fully created
  useEffect(() => {
    if (createPositionAPI.isSuccess && createPositionAPI.data) {
      onPositionCreated(createPositionAPI.data);
    }
  }, [createPositionAPI.isSuccess, createPositionAPI.data, onPositionCreated]);

  // Validation state for parent
  useEffect(() => {
    const canProceed =
      isConnected &&
      !isWrongNetwork &&
      !insufficientFunds &&
      !baseBalanceQuery.isLoading &&
      !quoteBalanceQuery.isLoading;

    onValidationChange(canProceed);
  }, [
    isConnected,
    isWrongNetwork,
    insufficientFunds,
    baseBalanceQuery.isLoading,
    quoteBalanceQuery.isLoading,
    onValidationChange,
  ]);

  // Can execute transactions?
  const canExecuteTransactions =
    isConnected && !isWrongNetwork && !insufficientFunds;

  // Handle approval clicks
  const handleApproval = (tokenType: 'base' | 'quote') => {
    if (tokenType === 'base') {
      baseApproval.approve();
    } else {
      quoteApproval.approve();
    }
  };

  // Handle mint click
  const handleOpenPosition = () => {
    mintPosition.mint();
  };

  // Create poolData structure for child components
  const poolData = {
    token0: {
      address: pool.pool.token0.config.address,
      symbol: pool.pool.token0.symbol,
      decimals: pool.pool.token0.decimals,
    },
    token1: {
      address: pool.pool.token1.config.address,
      symbol: pool.pool.token1.symbol,
      decimals: pool.pool.token1.decimals,
    },
  };

  return (
    <div className="space-y-6">
      {/* Position Size Configuration */}
      <PositionSizeConfig
        pool={localPool.pool}
        baseToken={localPool.pool.token0.config.address.toLowerCase() === baseToken.address.toLowerCase()
          ? localPool.pool.token0 as any
          : localPool.pool.token1 as any
        }
        quoteToken={localPool.pool.token0.config.address.toLowerCase() === quoteToken.address.toLowerCase()
          ? localPool.pool.token0 as any
          : localPool.pool.token1 as any
        }
        tickLower={tickLower}
        tickUpper={tickUpper}
        liquidity={liquidity}
        onLiquidityChange={onLiquidityChange}
        chain={chain}
        label="Final Position Size:"
        onRefreshPool={refetchPoolPrice}
      />

      {/* Wallet Balance Section */}
      <WalletBalanceSection
        pool={poolData}
        baseTokenAddress={baseToken.address}
        quoteTokenAddress={quoteToken.address}
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
          baseTokenAddress={baseToken.address}
          quoteTokenAddress={quoteToken.address}
          isConnected={isConnected}
          chain={chain}
        />
      )}

      {/* Transaction Steps List */}
      <TransactionStepsList
        pool={poolData}
        baseTokenAddress={baseToken.address}
        quoteTokenAddress={quoteToken.address}
        requiredBaseAmount={requiredBaseAmount}
        requiredQuoteAmount={requiredQuoteAmount}
        baseApproval={baseApproval}
        quoteApproval={quoteApproval}
        mintPosition={mintPosition}
        canExecuteTransactions={canExecuteTransactions}
        isConnected={isConnected}
        chain={chain}
        onApproval={handleApproval}
        onOpenPosition={handleOpenPosition}
      />

      {/* API Error */}
      {createPositionAPI.isError && (
        <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4">
          <p className="text-red-400 text-sm">
            Error creating position in database:{' '}
            {createPositionAPI.error instanceof Error
              ? createPositionAPI.error.message
              : 'Unknown error'}
          </p>
        </div>
      )}
    </div>
  );
}
