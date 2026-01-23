// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "../interfaces/IERC20.sol";
import { SafeERC20 } from "../libraries/SafeERC20.sol";

/**
 * @title IAugustusRegistry
 * @notice Interface for Paraswap's AugustusRegistry contract
 * @dev Used to verify that an Augustus swapper address is legitimate
 *
 * Registry addresses by chain:
 * - Ethereum (1):    0xa68bEA62Dc4034A689AA0F58A76681433caCa663
 * - Arbitrum (42161): 0xdC6E2b14260F972ad4e5a31c68294Fba7E720701
 * - Base (8453):     0x7e31b336f9e8ba52ba3c4ac861b033ba90900bb3
 * - Optimism (10):   0x6e7bE86000dF697facF4396efD2aE2C322165dC3
 */
interface IAugustusRegistry {
    /**
     * @notice Check if an address is a valid Augustus swapper
     * @param augustus The address to check
     * @return True if the address is a valid Augustus swapper
     */
    function isValidAugustus(address augustus) external view returns (bool);
}

/**
 * @title IAugustus
 * @notice Interface for Paraswap's Augustus swapper contract (V5)
 * @dev Used to get the TokenTransferProxy address for approvals
 */
interface IAugustus {
    /**
     * @notice Get the TokenTransferProxy address
     * @dev This is the address that needs token approval for swaps
     * @return The TokenTransferProxy address
     */
    function getTokenTransferProxy() external view returns (address);
}

/// @title ParaswapHelper
/// @notice Abstract base contract for Paraswap swap functionality
/// @dev Provides _sellToken and _buyToken internal functions
abstract contract ParaswapHelper {
    using SafeERC20 for IERC20;

    // ============ Errors ============

    error ZeroSwapAmount();
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
        if (sellAmount == 0) revert ZeroSwapAmount();
        if (swapData.length == 0) revert ZeroSwapAmount();

        // Record balance before
        uint256 buyBalanceBefore = IERC20(buyToken).balanceOf(address(this));

        // Decode swap params: (augustus, calldata)
        (address augustus, bytes memory swapCalldata) = abi.decode(swapData, (address, bytes));

        // Validate Augustus
        if (!augustusRegistry.isValidAugustus(augustus)) {
            revert InvalidAugustus();
        }

        // Get spender and approve
        address spender = IAugustus(augustus).getTokenTransferProxy();
        IERC20(sellToken).safeApprove(spender, sellAmount);

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
        IERC20(sellToken).safeApprove(spender, 0);

        // Calculate amount received
        uint256 buyBalanceAfter = IERC20(buyToken).balanceOf(address(this));
        amountReceived = buyBalanceAfter - buyBalanceBefore;

        // Validate minimum received
        if (amountReceived < minAmountReceived) {
            revert InsufficientAmountReceived(amountReceived, minAmountReceived);
        }
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
        if (buyAmount == 0) revert ZeroSwapAmount();
        if (swapData.length == 0) revert ZeroSwapAmount();

        // Record balances before
        uint256 sellBalanceBefore = IERC20(sellToken).balanceOf(address(this));
        uint256 buyBalanceBefore = IERC20(buyToken).balanceOf(address(this));

        // Decode swap params: (augustus, calldata)
        (address augustus, bytes memory swapCalldata) = abi.decode(swapData, (address, bytes));

        // Validate Augustus
        if (!augustusRegistry.isValidAugustus(augustus)) {
            revert InvalidAugustus();
        }

        // Get spender and approve max amount
        address spender = IAugustus(augustus).getTokenTransferProxy();
        IERC20(sellToken).safeApprove(spender, maxAmountSold);

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
        IERC20(sellToken).safeApprove(spender, 0);

        // Calculate amounts
        uint256 sellBalanceAfter = IERC20(sellToken).balanceOf(address(this));
        uint256 buyBalanceAfter = IERC20(buyToken).balanceOf(address(this));
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
    }
}
