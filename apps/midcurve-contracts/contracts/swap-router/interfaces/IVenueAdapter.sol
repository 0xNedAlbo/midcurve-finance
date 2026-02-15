// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IVenueAdapter
/// @notice Interface for DEX venue adapters used by MidcurveSwapRouter
/// @dev Each adapter encapsulates all interaction logic for a specific DEX protocol.
///      For swapExactInput: tokens are transferred to the adapter before the call.
///      For swapExactOutput: tokens are transferred to the adapter; adapter refunds unused portion.
interface IVenueAdapter {
    /// @notice Execute an exact-input swap
    /// @dev Tokens are transferred to the adapter by the router before this call.
    ///      The adapter must transfer all output tokens back to msg.sender (the router).
    /// @param tokenIn The input token address
    /// @param tokenOut The output token address
    /// @param amountIn The exact amount of tokenIn to spend (already held by adapter)
    /// @param venueData Venue-specific encoded parameters (e.g., fee tier for UniswapV3)
    /// @return amountOut The amount of tokenOut sent back to the router
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes calldata venueData
    ) external returns (uint256 amountOut);

    /// @notice Execute an exact-output swap
    /// @dev Tokens (amountInMaximum) are transferred to the adapter by the router before this call.
    ///      The adapter executes the swap, transfers exactly amountOut of tokenOut back to the router,
    ///      and refunds any unused tokenIn back to the router.
    /// @param tokenIn The input token address
    /// @param tokenOut The output token address
    /// @param amountOut The exact amount of tokenOut desired
    /// @param amountInMaximum The maximum amount of tokenIn available to spend
    /// @param venueData Venue-specific encoded parameters
    /// @return amountIn The actual amount of tokenIn consumed
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 amountInMaximum,
        bytes calldata venueData
    ) external returns (uint256 amountIn);
}
