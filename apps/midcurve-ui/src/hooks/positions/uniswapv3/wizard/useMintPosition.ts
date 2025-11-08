import { useState, useEffect } from 'react';
import type { Address, TransactionReceipt } from 'viem';
import { getAddress } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import {
  getNonfungiblePositionManagerAddress,
  NONFUNGIBLE_POSITION_MANAGER_ABI,
} from '@/config/contracts/nonfungible-position-manager';

export interface MintPositionParams {
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  tickSpacing: number;
  recipient: Address;
  chainId: number;
  slippageBps?: number; // Slippage in basis points (default: 50 = 0.5%)
}

export interface UseMintPositionResult {
  // Mint transaction
  mint: () => void;
  isMinting: boolean;
  isWaitingForConfirmation: boolean;
  mintError: Error | null;
  mintTxHash: Address | undefined;

  // Position result
  tokenId: bigint | undefined;
  isSuccess: boolean;
  receipt: TransactionReceipt | undefined;

  // Reset state
  reset: () => void;
}

/**
 * Hook to mint a new Uniswap V3 position NFT
 *
 * IMPORTANT: tickLower and tickUpper must be pre-aligned to the pool's tickSpacing.
 * Use the priceToClosestUsableTick() utility from '@midcurve/shared' which automatically
 * aligns ticks to the correct spacing.
 *
 * Handles:
 * - Validating ticks are aligned to pool's tick spacing
 * - Calculating slippage-adjusted minimum amounts (default 0.5%)
 * - Setting transaction deadline (20 minutes from now)
 * - Minting the position NFT via NonfungiblePositionManager
 * - Extracting tokenId from Transfer event in receipt
 *
 * @param params - Position parameters including tokens, pre-aligned ticks, amounts, and chain
 * @throws Error if ticks are not aligned to tickSpacing
 */
export function useMintPosition(
  params: MintPositionParams | null
): UseMintPositionResult {
  const [mintError, setMintError] = useState<Error | null>(null);
  const [tokenId, setTokenId] = useState<bigint | undefined>(undefined);

  const slippageBps = params?.slippageBps ?? 50; // Default 0.5% slippage

  // Get the NonfungiblePositionManager address for this chain
  const managerAddress = params?.chainId
    ? getNonfungiblePositionManagerAddress(params.chainId)
    : undefined;

  // Prepare mint parameters
  const mintParams = params ? prepareMintParams(params, slippageBps) : null;

  // Write contract for minting
  const {
    writeContract,
    data: mintTxHash,
    isPending: isMinting,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Wait for mint transaction confirmation
  const {
    isLoading: isWaitingForConfirmation,
    isSuccess,
    data: receipt,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: mintTxHash,
    chainId: params?.chainId,
  });

  // Handle mint errors (both pre-transaction and post-transaction)
  useEffect(() => {
    if (writeError) {
      setMintError(writeError);
    }
  }, [writeError]);

  // Handle transaction receipt errors (transaction sent but failed onchain)
  useEffect(() => {
    if (receiptError) {
      setMintError(receiptError);
    }
  }, [receiptError]);

  // Extract tokenId from transaction receipt
  useEffect(() => {
    if (isSuccess && receipt) {
      // Find the Transfer event from the NonfungiblePositionManager contract
      // The tokenId is in the third topic (tokenId) of the Transfer event
      const transferLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === managerAddress?.toLowerCase() &&
          log.topics[0] ===
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event signature
      );

      if (transferLog && transferLog.topics[3]) {
        try {
          // TokenId is in the 4th topic (index 3)
          const extractedTokenId = BigInt(transferLog.topics[3]);
          setTokenId(extractedTokenId);
        } catch (error) {
          console.error('Failed to extract tokenId from receipt:', error);
        }
      }
    }
  }, [isSuccess, receipt, managerAddress]);

  // Mint function
  const mint = () => {
    if (!params || !mintParams || !managerAddress) {
      setMintError(
        new Error('Missing required parameters for minting position')
      );
      return;
    }

    setMintError(null);
    setTokenId(undefined);

    try {
      // Ensure manager address is properly checksummed (EIP-55)
      const checksummedManagerAddress = getAddress(managerAddress);

      writeContract({
        address: checksummedManagerAddress,
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        functionName: 'mint',
        args: [mintParams],
        chainId: params.chainId,
      });
    } catch (error) {
      setMintError(error as Error);
    }
  };

  // Reset function
  const reset = () => {
    resetWrite();
    setMintError(null);
    setTokenId(undefined);
  };

  return {
    // Mint transaction
    mint,
    isMinting,
    isWaitingForConfirmation,
    mintError,
    mintTxHash,

    // Position result
    tokenId,
    isSuccess,
    receipt,

    // Reset
    reset,
  };
}

/**
 * Prepare mint parameters with tick validation and slippage protection
 *
 * Note: Ticks must be pre-aligned to tickSpacing before calling this function.
 * Use priceToClosestUsableTick() utility from @midcurve/shared which automatically aligns ticks.
 */
function prepareMintParams(params: MintPositionParams, slippageBps: number) {
  // Validate that ticks are pre-aligned to tick spacing
  // This catches bugs early and ensures consistency with amount calculations
  if (params.tickLower % params.tickSpacing !== 0) {
    throw new Error(
      `tickLower (${params.tickLower}) must be aligned to tickSpacing (${params.tickSpacing}). ` +
        `Use priceToClosestUsableTick() from @midcurve/shared to ensure proper alignment.`
    );
  }
  if (params.tickUpper % params.tickSpacing !== 0) {
    throw new Error(
      `tickUpper (${params.tickUpper}) must be aligned to tickSpacing (${params.tickSpacing}). ` +
        `Use priceToClosestUsableTick() from @midcurve/shared to ensure proper alignment.`
    );
  }

  // Calculate slippage-adjusted minimum amounts
  // Apply slippage tolerance: amountMin = amountDesired * (10000 - slippageBps) / 10000
  const amount0Min =
    (params.amount0Desired * BigInt(10000 - slippageBps)) / 10000n;
  const amount1Min =
    (params.amount1Desired * BigInt(10000 - slippageBps)) / 10000n;

  // Set deadline to 20 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes

  // Ensure all addresses are properly checksummed (EIP-55)
  return {
    token0: getAddress(params.token0),
    token1: getAddress(params.token1),
    fee: params.fee,
    tickLower: params.tickLower, // Use as-is (already validated as aligned)
    tickUpper: params.tickUpper, // Use as-is (already validated as aligned)
    amount0Desired: params.amount0Desired,
    amount1Desired: params.amount1Desired,
    amount0Min,
    amount1Min,
    recipient: getAddress(params.recipient),
    deadline,
  };
}
