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
///
///      Deployed as an EIP-1167 clone via MidcurveTreasuryFactory, one per environment per chain.
///      The split between constructor and initialize follows what is a chain fact and what is a
///      per-environment fact:
///
///      - `swapRouter` and `weth` are identical for every environment on a chain, so they are
///        immutables of the implementation. Immutables are inlined into the implementation's
///        runtime code, and a clone delegatecalls into that code, so every clone reads the chain's
///        values without spending a storage slot or an initialize argument. Their zero-address
///        checks therefore happen once per chain, at implementation deploy.
///      - `admin` and `operator` are per-environment, so they are storage, set by initialize().
///
///      initialize() is deliberately not access-controlled: the factory calls it in the same
///      transaction as the clone, so no uninitialized clone is ever observable, and anyone cloning
///      the implementation themselves is creating their own contract rather than claiming one of
///      ours. What makes an instance *ours* is the factory's attestation, not who called initialize.
contract MidcurveTreasury is IMidcurveTreasury {
    using SafeERC20 for IERC20;

    // ============================================================================
    // State
    // ============================================================================

    /// @dev admin and _initialized share slot 0 (20 bytes + 1 byte).
    address public admin;
    bool private _initialized;
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
    // Constructor / Initializer
    // ============================================================================

    /// @notice Deploy the implementation for one chain.
    /// @param swapRouter_ MidcurveSwapRouter address for token-to-WETH swaps
    /// @param weth_ WETH contract address
    constructor(address swapRouter_, address weth_) {
        if (swapRouter_ == address(0)) revert ZeroAddress();
        if (weth_ == address(0)) revert ZeroAddress();

        swapRouter = IMidcurveSwapRouter(swapRouter_);
        weth = weth_;

        // The implementation is never a treasury. Marking it initialized here means nobody can
        // adopt it by calling initialize() on it directly.
        _initialized = true;
    }

    /// @inheritdoc IMidcurveTreasury
    function initialize(address admin_, address operator_) external {
        if (_initialized) revert AlreadyInitialized();
        if (admin_ == address(0)) revert ZeroAddress();
        if (operator_ == address(0)) revert ZeroAddress();

        _initialized = true;
        admin = admin_;
        operator = operator_;
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
    function rescueEth(address to, uint256 amount) external onlyAdmin {
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
        uint256 wethAmount;

        if (tokenIn == weth) {
            // Direct path: WETH already in treasury, skip swap
            wethAmount = amountIn;
        } else {
            // Swap path: tokenIn -> WETH via router
            IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
            wethAmount = swapRouter.sell(tokenIn, weth, amountIn, minEthOut, address(this), deadline, hops);
            IERC20(tokenIn).forceApprove(address(swapRouter), 0);
        }

        // Unwrap WETH -> ETH
        IWETH(weth).withdraw(wethAmount);

        // Send ETH to operator
        (bool success,) = operator.call{ value: wethAmount }("");
        if (!success) revert EthTransferFailed();

        emit RefuelOperator(tokenIn, amountIn, wethAmount);
    }
}
