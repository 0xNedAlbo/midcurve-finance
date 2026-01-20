// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IParaswap.sol";
import "../interfaces/IERC20Minimal.sol";

/// @title ParaswapBase
/// @notice Abstract base contract for Paraswap swap functionality
/// @dev Provides _sellToken and _buyToken with hooks for post-swap validation
abstract contract ParaswapBase {
    // ============ Errors ============

    error ZeroAmount();
    error InvalidAugustus();
    error InsufficientAmountReceived(uint256 received, uint256 minimum);
    error ExcessiveAmountSpent(uint256 spent, uint256 maximum);
    error SwapFailed();

    // ============ Immutables ============

    IAugustusRegistry public immutable augustusRegistry;

    // ============ Constructor ============

    constructor(address augustusRegistry_) {
        augustusRegistry = IAugustusRegistry(augustusRegistry_);
    }

    // ============ Internal Swap Functions ============

    /// @notice Sell exact amount of a token via Paraswap
    /// @param sellToken Token to sell
    /// @param buyToken Token to receive
    /// @param sellAmount Exact amount of sellToken to sell
    /// @param minAmountReceived Minimum amount of buyToken to receive
    /// @param swapData Paraswap calldata (abi.encode(augustus, swapCalldata))
    /// @return amountReceived Actual amount of buyToken received
    function _sellToken(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minAmountReceived,
        bytes calldata swapData
    ) internal virtual returns (uint256 amountReceived) {
        if (sellAmount == 0) revert ZeroAmount();
        if (swapData.length == 0) revert ZeroAmount();

        // Record balance before
        uint256 buyBalanceBefore = IERC20Minimal(buyToken).balanceOf(address(this));

        // Decode swap params: (augustus, calldata)
        (address augustus, bytes memory swapCalldata) = abi.decode(swapData, (address, bytes));

        // Validate Augustus
        if (!augustusRegistry.isValidAugustus(augustus)) {
            revert InvalidAugustus();
        }

        // Get spender and approve
        address spender = IAugustus(augustus).getTokenTransferProxy();
        _safeApprove(sellToken, spender, sellAmount);

        // Execute swap
        (bool success, bytes memory returnData) = augustus.call(swapCalldata);
        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
            revert SwapFailed();
        }

        // Reset approval
        _safeApprove(sellToken, spender, 0);

        // Calculate amount received
        uint256 buyBalanceAfter = IERC20Minimal(buyToken).balanceOf(address(this));
        amountReceived = buyBalanceAfter - buyBalanceBefore;

        // Validate minimum received
        if (amountReceived < minAmountReceived) {
            revert InsufficientAmountReceived(amountReceived, minAmountReceived);
        }

        // Post-swap hook for additional validation (e.g., TWAP check)
        _afterSwap(sellToken, buyToken, sellAmount, amountReceived);
    }

    /// @notice Buy exact amount of a token via Paraswap
    /// @param buyToken Token to buy
    /// @param sellToken Token to spend
    /// @param buyAmount Exact amount of buyToken to buy
    /// @param maxAmountSold Maximum amount of sellToken to spend
    /// @param swapData Paraswap calldata (abi.encode(augustus, swapCalldata))
    /// @return amountSold Actual amount of sellToken spent
    function _buyToken(
        address buyToken,
        address sellToken,
        uint256 buyAmount,
        uint256 maxAmountSold,
        bytes calldata swapData
    ) internal virtual returns (uint256 amountSold) {
        if (buyAmount == 0) revert ZeroAmount();
        if (swapData.length == 0) revert ZeroAmount();

        // Record balances before
        uint256 sellBalanceBefore = IERC20Minimal(sellToken).balanceOf(address(this));
        uint256 buyBalanceBefore = IERC20Minimal(buyToken).balanceOf(address(this));

        // Decode swap params: (augustus, calldata)
        (address augustus, bytes memory swapCalldata) = abi.decode(swapData, (address, bytes));

        // Validate Augustus
        if (!augustusRegistry.isValidAugustus(augustus)) {
            revert InvalidAugustus();
        }

        // Get spender and approve max amount
        address spender = IAugustus(augustus).getTokenTransferProxy();
        _safeApprove(sellToken, spender, maxAmountSold);

        // Execute swap
        (bool success, bytes memory returnData) = augustus.call(swapCalldata);
        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
            revert SwapFailed();
        }

        // Reset approval
        _safeApprove(sellToken, spender, 0);

        // Calculate amounts
        uint256 sellBalanceAfter = IERC20Minimal(sellToken).balanceOf(address(this));
        uint256 buyBalanceAfter = IERC20Minimal(buyToken).balanceOf(address(this));
        amountSold = sellBalanceBefore - sellBalanceAfter;
        uint256 amountBought = buyBalanceAfter - buyBalanceBefore;

        // Validate we got enough
        if (amountBought < buyAmount) {
            revert InsufficientAmountReceived(amountBought, buyAmount);
        }

        // Validate we didn't spend too much
        if (amountSold > maxAmountSold) {
            revert ExcessiveAmountSpent(amountSold, maxAmountSold);
        }

        // Post-swap hook for additional validation (e.g., TWAP check)
        _afterSwap(sellToken, buyToken, amountSold, amountBought);
    }

    // ============ Hooks ============

    /// @dev Override to add post-swap validation (e.g., TWAP price check)
    /// @param sellToken Token that was sold
    /// @param buyToken Token that was bought
    /// @param sellAmount Amount of sellToken spent
    /// @param buyAmount Amount of buyToken received
    function _afterSwap(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 buyAmount
    ) internal virtual {}

    // ============ Internal Helpers (abstract) ============

    /// @dev Must be implemented by inheriting contract
    /// @param token Token to approve
    /// @param spender Address to approve
    /// @param amount Amount to approve
    function _safeApprove(address token, address spender, uint256 amount) internal virtual;
}
