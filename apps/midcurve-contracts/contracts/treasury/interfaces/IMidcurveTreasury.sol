// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IMidcurveSwapRouter } from "../../swap-router/interfaces/IMidcurveSwapRouter.sol";

/// @title IMidcurveTreasury
/// @notice Interface for the Midcurve Treasury — collects execution fees and refuels the operator wallet
interface IMidcurveTreasury {
    // ============================================================================
    // Events
    // ============================================================================

    event Sweep(address indexed token, address indexed to, uint256 amount);
    event RefuelOperator(address indexed tokenIn, uint256 amountIn, uint256 ethOut);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event EthRescued(address indexed to, uint256 amount);

    // ============================================================================
    // Errors
    // ============================================================================

    error NotAdmin();
    error NotAdminOrOperator();
    error ZeroAddress();
    error EthTransferFailed();

    // ============================================================================
    // Functions
    // ============================================================================

    /// @notice Transfer any ERC20 token held by the treasury to an arbitrary address
    /// @param token ERC20 token address
    /// @param to Recipient address
    /// @param amount Amount to transfer
    function sweep(address token, address to, uint256 amount) external;

    /// @notice Swap an ERC20 token to WETH, unwrap to ETH, and send to the operator wallet
    /// @param tokenIn ERC20 token to sell
    /// @param amountIn Amount of tokenIn to sell
    /// @param minEthOut Minimum ETH to receive (slippage protection)
    /// @param deadline Unix timestamp after which the swap reverts
    /// @param hops Swap path through MidcurveSwapRouter (computed off-chain)
    function refuelOperator(
        address tokenIn,
        uint256 amountIn,
        uint256 minEthOut,
        uint256 deadline,
        IMidcurveSwapRouter.Hop[] calldata hops
    ) external;

    /// @notice Rescue ETH held by the treasury (e.g. from selfdestruct or direct sends)
    /// @param to Recipient address
    /// @param amount Amount of ETH to send
    function rescueETH(address to, uint256 amount) external;

    /// @notice Update the operator address that receives ETH from refueling
    /// @param newOperator New operator address
    function setOperator(address newOperator) external;

    /// @notice Transfer the admin role to a new address
    /// @param newAdmin New admin address
    function transferAdmin(address newAdmin) external;

    // ============================================================================
    // View Functions
    // ============================================================================

    function admin() external view returns (address);
    function operator() external view returns (address);
    function swapRouter() external view returns (IMidcurveSwapRouter);
    function weth() external view returns (address);
}
