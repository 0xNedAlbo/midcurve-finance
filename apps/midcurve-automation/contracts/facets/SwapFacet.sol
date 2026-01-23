// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AppStorage, LibAppStorage, Modifiers} from "../storage/AppStorage.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {SafeERC20} from "../libraries/SafeERC20.sol";

/// @notice Interface for Paraswap's AugustusRegistry
interface IAugustusRegistry {
    function isValidAugustus(address augustus) external view returns (bool);
}

/// @notice Interface for Paraswap's Augustus swapper
interface IAugustus {
    function getTokenTransferProxy() external view returns (address);
}

/// @title SwapFacet
/// @notice Public swap functions for multicall UX (single-token entry/exit workflows)
/// @dev Allows anyone to perform swaps on vault balances, with balance validation
contract SwapFacet is Modifiers {
    using SafeERC20 for IERC20;

    // ============ Events ============

    event TokenSold(
        address indexed caller,
        address indexed sellToken,
        address indexed buyToken,
        uint256 sellAmount,
        uint256 amountReceived
    );

    event TokenBought(
        address indexed caller,
        address indexed buyToken,
        address indexed sellToken,
        uint256 buyAmount,
        uint256 amountSold
    );

    // ============ Errors ============

    error InvalidTokenPair();
    error VaultBalanceDecreased(address token, uint256 expected, uint256 actual);
    error ZeroSwapAmount();
    error InvalidAugustus();
    error InsufficientAmountReceived(uint256 received, uint256 minimum);
    error ExcessiveAmountSpent(uint256 spent, uint256 maximum);
    error SwapFailed();

    // ============ Public Swap Functions ============

    /// @notice Sell exact amount of a token via Paraswap (for multicall UX)
    /// @dev Callable by anyone. Ensures vault balances don't decrease unexpectedly.
    /// @param sellToken Token to sell (must be asset0 or asset1)
    /// @param buyToken Token to receive (must be asset0 or asset1)
    /// @param sellAmount Exact amount to sell
    /// @param minAmountReceived Minimum amount to receive (slippage protection)
    /// @param swapData Paraswap calldata (abi.encode(augustus, swapCalldata))
    /// @return amountReceived Actual amount received
    function performTokenSell(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minAmountReceived,
        bytes calldata swapData
    ) external nonReentrant returns (uint256 amountReceived) {
        AppStorage storage s = LibAppStorage.appStorage();

        // Validate tokens are vault assets
        if (!((sellToken == s.asset0 && buyToken == s.asset1) || (sellToken == s.asset1 && buyToken == s.asset0))) {
            revert InvalidTokenPair();
        }

        // Record vault balances before
        uint256 totalBefore0 = IERC20(s.asset0).balanceOf(address(this));
        uint256 totalBefore1 = IERC20(s.asset1).balanceOf(address(this));

        // Execute swap
        amountReceived = _sellToken(sellToken, buyToken, sellAmount, minAmountReceived, swapData);

        // Record vault balances after
        uint256 totalAfter0 = IERC20(s.asset0).balanceOf(address(this));
        uint256 totalAfter1 = IERC20(s.asset1).balanceOf(address(this));

        // Verify balances
        if (sellToken == s.asset0) {
            if (totalAfter1 < totalBefore1) {
                revert VaultBalanceDecreased(s.asset1, totalBefore1, totalAfter1);
            }
            if (totalAfter0 < totalBefore0 - sellAmount) {
                revert VaultBalanceDecreased(s.asset0, totalBefore0 - sellAmount, totalAfter0);
            }
        } else {
            if (totalAfter0 < totalBefore0) {
                revert VaultBalanceDecreased(s.asset0, totalBefore0, totalAfter0);
            }
            if (totalAfter1 < totalBefore1 - sellAmount) {
                revert VaultBalanceDecreased(s.asset1, totalBefore1 - sellAmount, totalAfter1);
            }
        }

        emit TokenSold(msg.sender, sellToken, buyToken, sellAmount, amountReceived);
    }

    /// @notice Buy exact amount of a token via Paraswap (for multicall UX)
    /// @dev Callable by anyone. Ensures vault balances don't decrease unexpectedly.
    /// @param buyToken Token to buy (must be asset0 or asset1)
    /// @param sellToken Token to spend (must be asset0 or asset1)
    /// @param buyAmount Exact amount to buy
    /// @param maxAmountSold Maximum amount to spend (slippage protection)
    /// @param swapData Paraswap calldata (abi.encode(augustus, swapCalldata))
    /// @return amountSold Actual amount spent
    function performTokenBuy(
        address buyToken,
        address sellToken,
        uint256 buyAmount,
        uint256 maxAmountSold,
        bytes calldata swapData
    ) external nonReentrant returns (uint256 amountSold) {
        AppStorage storage s = LibAppStorage.appStorage();

        // Validate tokens are vault assets
        if (!((sellToken == s.asset0 && buyToken == s.asset1) || (sellToken == s.asset1 && buyToken == s.asset0))) {
            revert InvalidTokenPair();
        }

        // Record vault balances before
        uint256 totalBefore0 = IERC20(s.asset0).balanceOf(address(this));
        uint256 totalBefore1 = IERC20(s.asset1).balanceOf(address(this));

        // Execute swap
        amountSold = _buyToken(buyToken, sellToken, buyAmount, maxAmountSold, swapData);

        // Record vault balances after
        uint256 totalAfter0 = IERC20(s.asset0).balanceOf(address(this));
        uint256 totalAfter1 = IERC20(s.asset1).balanceOf(address(this));

        // Verify balances
        if (sellToken == s.asset0) {
            if (totalAfter1 < totalBefore1) {
                revert VaultBalanceDecreased(s.asset1, totalBefore1, totalAfter1);
            }
            if (totalAfter0 < totalBefore0 - amountSold) {
                revert VaultBalanceDecreased(s.asset0, totalBefore0 - amountSold, totalAfter0);
            }
        } else {
            if (totalAfter0 < totalBefore0) {
                revert VaultBalanceDecreased(s.asset0, totalBefore0, totalAfter0);
            }
            if (totalAfter1 < totalBefore1 - amountSold) {
                revert VaultBalanceDecreased(s.asset1, totalBefore1 - amountSold, totalAfter1);
            }
        }

        emit TokenBought(msg.sender, buyToken, sellToken, buyAmount, amountSold);
    }

    // ============ Internal Swap Functions ============

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

    function _buyToken(
        address buyToken,
        address sellToken,
        uint256 buyAmount,
        uint256 maxAmountSold,
        bytes calldata swapData
    ) internal returns (uint256 amountSold) {
        AppStorage storage s = LibAppStorage.appStorage();

        if (buyAmount == 0) revert ZeroSwapAmount();
        if (swapData.length == 0) revert ZeroSwapAmount();

        uint256 sellBalanceBefore = IERC20(sellToken).balanceOf(address(this));
        uint256 buyBalanceBefore = IERC20(buyToken).balanceOf(address(this));

        (address augustus, bytes memory swapCalldata) = abi.decode(swapData, (address, bytes));

        if (!IAugustusRegistry(s.augustusRegistry).isValidAugustus(augustus)) {
            revert InvalidAugustus();
        }

        address spender = IAugustus(augustus).getTokenTransferProxy();
        IERC20(sellToken).safeApprove(spender, maxAmountSold);

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

        uint256 sellBalanceAfter = IERC20(sellToken).balanceOf(address(this));
        uint256 buyBalanceAfter = IERC20(buyToken).balanceOf(address(this));
        amountSold = sellBalanceBefore - sellBalanceAfter;
        uint256 amountBought = buyBalanceAfter - buyBalanceBefore;

        if (amountBought < buyAmount) {
            revert InsufficientAmountReceived(amountBought, buyAmount);
        }

        if (amountSold > maxAmountSold) {
            revert ExcessiveAmountSpent(amountSold, maxAmountSold);
        }
    }
}
