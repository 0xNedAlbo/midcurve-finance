// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IVenueAdapter } from "../interfaces/IVenueAdapter.sol";
import { IV3SwapRouter } from "../interfaces/IV3SwapRouter.sol";

/// @title UniswapV3Adapter
/// @notice Venue adapter for Uniswap V3 SwapRouter02
/// @dev venueData encoding: abi.encode(uint24 fee)
///      The adapter derives the pool from tokenIn, tokenOut, and fee internally via the SwapRouter.
contract UniswapV3Adapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    // ============================================================================
    // Constants & Immutables
    // ============================================================================

    /// @notice Venue identifier for registration with the MidcurveSwapRouter
    bytes32 public constant VENUE_ID = keccak256("UniswapV3");

    /// @notice The Uniswap V3 SwapRouter02 contract
    IV3SwapRouter public immutable swapRouter;

    // ============================================================================
    // Errors
    // ============================================================================

    error ZeroAddress();

    // ============================================================================
    // Constructor
    // ============================================================================

    /// @param swapRouter_ Address of the Uniswap V3 SwapRouter02
    constructor(address swapRouter_) {
        if (swapRouter_ == address(0)) revert ZeroAddress();
        swapRouter = IV3SwapRouter(swapRouter_);
    }

    // ============================================================================
    // IVenueAdapter Implementation
    // ============================================================================

    /// @inheritdoc IVenueAdapter
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes calldata venueData
    ) external returns (uint256 amountOut) {
        uint24 fee = abi.decode(venueData, (uint24));

        // Approve SwapRouter to spend tokenIn (handles USDT-style tokens)
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);

        // Execute exact input swap — output goes to msg.sender (the router)
        amountOut = swapRouter.exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: 0, // Slippage checked at router level
                sqrtPriceLimitX96: 0 // No per-hop price limit
            })
        );

        // Reset approval for safety
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);
    }

    /// @inheritdoc IVenueAdapter
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 amountInMaximum,
        bytes calldata venueData
    ) external returns (uint256 amountIn) {
        uint24 fee = abi.decode(venueData, (uint24));

        // Approve SwapRouter to spend up to amountInMaximum
        IERC20(tokenIn).forceApprove(address(swapRouter), amountInMaximum);

        // Execute exact output swap — output goes to msg.sender (the router)
        amountIn = swapRouter.exactOutputSingle(
            IV3SwapRouter.ExactOutputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender,
                amountOut: amountOut,
                amountInMaximum: amountInMaximum,
                sqrtPriceLimitX96: 0
            })
        );

        // Reset approval for safety
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);

        // Refund unused tokenIn back to the router
        uint256 remaining = IERC20(tokenIn).balanceOf(address(this));
        if (remaining > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, remaining);
        }
    }
}
