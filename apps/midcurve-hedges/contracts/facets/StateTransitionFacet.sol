// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, VaultState, Modifiers} from "../storage/AppStorage.sol";
import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3PoolMinimal} from "../interfaces/IUniswapV3PoolMinimal.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {LibVault} from "../libraries/LibVault.sol";
import {UniswapV3Math} from "../libraries/UniswapV3Math.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {SafeERC20} from "../libraries/SafeERC20.sol";

/// @notice Interface for Paraswap's AugustusRegistry
interface IAugustusRegistry {
    function isValidAugustus(address augustus) external view returns (bool);
}

/// @notice Interface for Paraswap's Augustus swapper
interface IAugustus {
    function getTokenTransferProxy() external view returns (address);
}

/// @title StateTransitionFacet
/// @notice Handles vault state transitions (exit to single asset, return to position, close)
/// @dev Manages the hedging state machine with Paraswap swap execution
contract StateTransitionFacet is Modifiers {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    /// @notice Parameters for Paraswap swap execution
    struct SwapSellParams {
        uint256 minBuyAmount;
        bytes swapCalldata;
    }

    // ============ Events ============

    event ExitedToAsset0(VaultState indexed previousState, uint256 balance0);
    event ExitedToAsset1(VaultState indexed previousState, uint256 balance1);
    event ReturnedToPosition(VaultState indexed previousState, uint128 liquidity);
    event VaultClosed(uint256 finalBalance0, uint256 dustSweptToFees);

    // ============ Errors ============

    error InvalidState();
    error ZeroSwapAmount();
    error InvalidAugustus();
    error InsufficientAmountReceived(uint256 received, uint256 minimum);
    error SwapFailed();

    // ============ State Transitions ============

    /// @notice Exit to asset0-only state (swap all asset1 to asset0)
    /// @param swapParams Paraswap swap parameters
    function exitToAsset0(SwapSellParams calldata swapParams) external onlyManagerOrOperator nonReentrant whenNotPaused {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState != VaultState.IN_POSITION && s.currentState != VaultState.IN_ASSET1) {
            revert InvalidState();
        }

        VaultState previousState = s.currentState;

        // If in position, exit first
        if (s.currentState == VaultState.IN_POSITION) {
            (uint256 expected0, uint256 expected1) = LibVault.getPositionAmounts();
            uint256 minAmount0 = (expected0 * (10000 - s.exitPositionSlippageBps)) / 10000;
            uint256 minAmount1 = (expected1 * (10000 - s.exitPositionSlippageBps)) / 10000;
            _exitPosition(minAmount0, minAmount1);
        }

        // Swap all asset1 to asset0
        (, uint256 sellAmount) = LibVault.getVaultBalances();
        if (sellAmount > 0) {
            _sellToken(s.asset1, s.asset0, sellAmount, swapParams.minBuyAmount, swapParams.swapCalldata);
        }

        s.currentState = VaultState.IN_ASSET0;
        (uint256 balance0, ) = LibVault.getVaultBalances();
        emit ExitedToAsset0(previousState, balance0);
    }

    /// @notice Exit to asset1-only state (swap all asset0 to asset1)
    /// @param swapParams Paraswap swap parameters
    function exitToAsset1(SwapSellParams calldata swapParams) external onlyManagerOrOperator nonReentrant whenNotPaused {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState != VaultState.IN_POSITION && s.currentState != VaultState.IN_ASSET0) {
            revert InvalidState();
        }

        VaultState previousState = s.currentState;

        // If in position, exit first
        if (s.currentState == VaultState.IN_POSITION) {
            (uint256 expected0, uint256 expected1) = LibVault.getPositionAmounts();
            uint256 minAmount0 = (expected0 * (10000 - s.exitPositionSlippageBps)) / 10000;
            uint256 minAmount1 = (expected1 * (10000 - s.exitPositionSlippageBps)) / 10000;
            _exitPosition(minAmount0, minAmount1);
        }

        // Swap all asset0 to asset1
        (uint256 sellAmount, ) = LibVault.getVaultBalances();
        if (sellAmount > 0) {
            _sellToken(s.asset0, s.asset1, sellAmount, swapParams.minBuyAmount, swapParams.swapCalldata);
        }

        s.currentState = VaultState.IN_ASSET1;
        (, uint256 balance1) = LibVault.getVaultBalances();
        emit ExitedToAsset1(previousState, balance1);
    }

    /// @notice Return to position state from single-asset state
    /// @param swapParams Paraswap swap parameters
    function returnToPosition(SwapSellParams calldata swapParams) external onlyManagerOrOperator nonReentrant whenNotPaused {
        AppStorage storage s = LibAppStorage.appStorage();

        VaultState previousState = s.currentState;

        if (s.currentState == VaultState.IN_ASSET0) {
            _returnToPositionFromAsset0(swapParams);
        } else if (s.currentState == VaultState.IN_ASSET1) {
            _returnToPositionFromAsset1(swapParams);
        } else {
            revert InvalidState();
        }

        s.currentState = VaultState.IN_POSITION;
        (, , , , , , , uint128 liquidity, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);
        emit ReturnedToPosition(previousState, liquidity);
    }

    /// @notice Close the vault permanently
    function closeVault() external onlyManager nonReentrant {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState != VaultState.IN_ASSET0) {
            revert InvalidState();
        }

        // Sweep any asset1 dust into fees
        (, uint256 dust1) = LibVault.getVaultBalances();
        if (dust1 > 0) {
            LibVault.updateFeeAccumulators(0, dust1);
        }

        s.currentState = VaultState.CLOSED;
        (uint256 finalBalance0, ) = LibVault.getVaultBalances();
        emit VaultClosed(finalBalance0, dust1);
    }

    // ============ Preview Functions ============

    /// @notice Preview the sellAmount for exitToAsset0
    function previewExitToAsset0() external view returns (uint256 sellAmount) {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState != VaultState.IN_POSITION && s.currentState != VaultState.IN_ASSET1) {
            return 0;
        }

        (, uint256 vaultBalance1) = LibVault.getVaultBalances();

        if (s.currentState == VaultState.IN_POSITION) {
            (, uint256 positionAmount1) = LibVault.getPositionAmounts();
            sellAmount = vaultBalance1 + positionAmount1;
        } else {
            sellAmount = vaultBalance1;
        }
    }

    /// @notice Preview the sellAmount for exitToAsset1
    function previewExitToAsset1() external view returns (uint256 sellAmount) {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState != VaultState.IN_POSITION && s.currentState != VaultState.IN_ASSET0) {
            return 0;
        }

        (uint256 vaultBalance0, ) = LibVault.getVaultBalances();

        if (s.currentState == VaultState.IN_POSITION) {
            (uint256 positionAmount0, ) = LibVault.getPositionAmounts();
            sellAmount = vaultBalance0 + positionAmount0;
        } else {
            sellAmount = vaultBalance0;
        }
    }

    /// @notice Preview swap details for returnToPosition
    function previewReturnToPosition() external view returns (address sellToken, uint256 sellAmount) {
        AppStorage storage s = LibAppStorage.appStorage();

        if (s.currentState != VaultState.IN_ASSET0 && s.currentState != VaultState.IN_ASSET1) {
            return (address(0), 0);
        }

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(s.tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(s.tickUpper);

        if (s.currentState == VaultState.IN_ASSET0) {
            (uint256 balance0, ) = LibVault.getVaultBalances();
            sellToken = s.asset0;
            sellAmount = UniswapV3Math.computeIdealSwapAmountSingleSided(
                balance0,
                sqrtPriceX96,
                sqrtRatioAX96,
                sqrtRatioBX96,
                UniswapV3Math.SingleSidedInput.TOKEN0_ONLY
            );
        } else {
            (, uint256 balance1) = LibVault.getVaultBalances();
            sellToken = s.asset1;
            sellAmount = UniswapV3Math.computeIdealSwapAmountSingleSided(
                balance1,
                sqrtPriceX96,
                sqrtRatioAX96,
                sqrtRatioBX96,
                UniswapV3Math.SingleSidedInput.TOKEN1_ONLY
            );
        }
    }

    // ============ Internal Functions ============

    function _exitPosition(uint256 minAmount0, uint256 minAmount1) internal returns (uint256 amount0, uint256 amount1) {
        AppStorage storage s = LibAppStorage.appStorage();

        // Collect pending fees
        (uint256 fees0, uint256 fees1) = LibVault.collectPositionFees();
        LibVault.updateFeeAccumulators(fees0, fees1);

        // Get current liquidity
        (, , , , , , , uint128 liquidity, , , , ) = INonfungiblePositionManager(s.positionManager).positions(s.positionId);

        if (liquidity > 0) {
            (amount0, amount1) = LibVault.decreaseLiquidity(liquidity, minAmount0, minAmount1);
        }
    }

    function _returnToPositionFromAsset0(SwapSellParams calldata swapParams) internal {
        AppStorage storage s = LibAppStorage.appStorage();

        (uint256 balance0, ) = LibVault.getVaultBalances();
        if (balance0 == 0) return;

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(s.tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(s.tickUpper);

        uint256 swapAmount = UniswapV3Math.computeIdealSwapAmountSingleSided(
            balance0,
            sqrtPriceX96,
            sqrtRatioAX96,
            sqrtRatioBX96,
            UniswapV3Math.SingleSidedInput.TOKEN0_ONLY
        );

        if (swapAmount > 0) {
            _sellToken(s.asset0, s.asset1, swapAmount, swapParams.minBuyAmount, swapParams.swapCalldata);
        }

        _addLiquidityFromBalances();
    }

    function _returnToPositionFromAsset1(SwapSellParams calldata swapParams) internal {
        AppStorage storage s = LibAppStorage.appStorage();

        (, uint256 balance1) = LibVault.getVaultBalances();
        if (balance1 == 0) return;

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(s.tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(s.tickUpper);

        uint256 swapAmount = UniswapV3Math.computeIdealSwapAmountSingleSided(
            balance1,
            sqrtPriceX96,
            sqrtRatioAX96,
            sqrtRatioBX96,
            UniswapV3Math.SingleSidedInput.TOKEN1_ONLY
        );

        if (swapAmount > 0) {
            _sellToken(s.asset1, s.asset0, swapAmount, swapParams.minBuyAmount, swapParams.swapCalldata);
        }

        _addLiquidityFromBalances();
    }

    function _addLiquidityFromBalances() internal {
        AppStorage storage s = LibAppStorage.appStorage();

        (uint256 balance0, uint256 balance1) = LibVault.getVaultBalances();
        if (balance0 == 0 && balance1 == 0) return;

        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3PoolMinimal(s.pool).slot0();
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(s.tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(s.tickUpper);

        uint128 liquidity = UniswapV3Math.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtRatioAX96,
            sqrtRatioBX96,
            balance0,
            balance1
        );

        if (liquidity == 0) return;

        (uint256 amount0, uint256 amount1) = UniswapV3Math.getAmountsForLiquidity(
            sqrtPriceX96,
            s.tickLower,
            s.tickUpper,
            liquidity
        );

        if (amount0 == 0 && amount1 == 0) return;

        uint256 minAmount0 = (amount0 * (10000 - s.enterPositionSlippageBps)) / 10000;
        uint256 minAmount1 = (amount1 * (10000 - s.enterPositionSlippageBps)) / 10000;

        IERC20(s.asset0).safeApprove(s.positionManager, amount0);
        IERC20(s.asset1).safeApprove(s.positionManager, amount1);

        INonfungiblePositionManager(s.positionManager).increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: s.positionId,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: minAmount0,
                amount1Min: minAmount1,
                deadline: block.timestamp
            })
        );

        IERC20(s.asset0).safeApprove(s.positionManager, 0);
        IERC20(s.asset1).safeApprove(s.positionManager, 0);
    }

    function _sellToken(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minAmountReceived,
        bytes calldata swapData
    ) internal returns (uint256 amountReceived) {
        AppStorage storage s = LibAppStorage.appStorage();

        if (sellAmount == 0) revert ZeroSwapAmount();
        if (swapData.length == 0) revert ZeroSwapAmount();

        uint256 buyBalanceBefore = IERC20(buyToken).balanceOf(address(this));

        (address augustus, bytes memory swapCalldata) = abi.decode(swapData, (address, bytes));

        if (!IAugustusRegistry(s.augustusRegistry).isValidAugustus(augustus)) {
            revert InvalidAugustus();
        }

        address spender = IAugustus(augustus).getTokenTransferProxy();
        IERC20(sellToken).safeApprove(spender, sellAmount);

        (bool success, bytes memory returnData) = augustus.call(swapCalldata);
        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
            revert SwapFailed();
        }

        IERC20(sellToken).safeApprove(spender, 0);

        uint256 buyBalanceAfter = IERC20(buyToken).balanceOf(address(this));
        amountReceived = buyBalanceAfter - buyBalanceBefore;

        if (amountReceived < minAmountReceived) {
            revert InsufficientAmountReceived(amountReceived, minAmountReceived);
        }
    }
}
