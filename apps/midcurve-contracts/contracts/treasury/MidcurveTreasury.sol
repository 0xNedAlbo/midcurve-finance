// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IMidcurveSwapRouter } from "../swap-router/interfaces/IMidcurveSwapRouter.sol";
import { IMidcurveTreasury } from "./interfaces/IMidcurveTreasury.sol";
import { IWETH } from "./interfaces/IWETH.sol";

/// @title MidcurveTreasury
/// @notice Collects ERC20 execution fees and converts them to ETH for operator gas refueling.
/// @dev Fee tokens accumulate from order executions. The admin or operator can call refuelOperator()
///      to swap tokens to WETH via MidcurveSwapRouter, unwrap to ETH, and send to the operator wallet.
contract MidcurveTreasury is IMidcurveTreasury {
    using SafeERC20 for IERC20;

    // ============================================================================
    // State
    // ============================================================================

    address public admin;
    address public operator;
    IMidcurveSwapRouter public immutable swapRouter;
    address public immutable weth;

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAdminOrOperator() {
        if (msg.sender != admin && msg.sender != operator) revert NotAdminOrOperator();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    /// @param admin_ Initial admin address
    /// @param operator_ Operator wallet that receives ETH from refueling
    /// @param swapRouter_ MidcurveSwapRouter address for token-to-WETH swaps
    /// @param weth_ WETH contract address
    constructor(address admin_, address operator_, address swapRouter_, address weth_) {
        if (admin_ == address(0)) revert ZeroAddress();
        if (operator_ == address(0)) revert ZeroAddress();
        if (swapRouter_ == address(0)) revert ZeroAddress();
        if (weth_ == address(0)) revert ZeroAddress();

        admin = admin_;
        operator = operator_;
        swapRouter = IMidcurveSwapRouter(swapRouter_);
        weth = weth_;
    }

    // ============================================================================
    // Receive
    // ============================================================================

    /// @dev Accept ETH from WETH.withdraw() and other sources
    receive() external payable {}

    // ============================================================================
    // Admin Functions
    // ============================================================================

    /// @inheritdoc IMidcurveTreasury
    function sweep(address token, address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Sweep(token, to, amount);
    }

    /// @inheritdoc IMidcurveTreasury
    function rescueETH(address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        (bool success,) = to.call{ value: amount }("");
        if (!success) revert EthTransferFailed();
        emit EthRescued(to, amount);
    }

    /// @inheritdoc IMidcurveTreasury
    function setOperator(address newOperator) external onlyAdmin {
        if (newOperator == address(0)) revert ZeroAddress();
        address oldOperator = operator;
        operator = newOperator;
        emit OperatorUpdated(oldOperator, newOperator);
    }

    /// @inheritdoc IMidcurveTreasury
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminTransferred(oldAdmin, newAdmin);
    }

    // ============================================================================
    // Refuel
    // ============================================================================

    /// @inheritdoc IMidcurveTreasury
    function refuelOperator(
        address tokenIn,
        uint256 amountIn,
        uint256 minEthOut,
        uint256 deadline,
        IMidcurveSwapRouter.Hop[] calldata hops
    ) external onlyAdminOrOperator {
        // 1. Approve router to pull tokenIn
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);

        // 2. Swap tokenIn -> WETH via router (WETH sent to this contract)
        uint256 wethReceived = swapRouter.sell(tokenIn, weth, amountIn, minEthOut, address(this), deadline, hops);

        // 3. Unwrap WETH -> ETH
        IWETH(weth).withdraw(wethReceived);

        // 4. Send ETH to operator
        (bool success,) = operator.call{ value: wethReceived }("");
        if (!success) revert EthTransferFailed();

        // 5. Reset approval
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);

        emit RefuelOperator(tokenIn, amountIn, wethReceived);
    }
}
