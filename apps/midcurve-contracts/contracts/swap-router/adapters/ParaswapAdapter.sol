// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IVenueAdapter } from "../interfaces/IVenueAdapter.sol";

/// @title ParaswapAdapter
/// @notice Venue adapter that delegates swaps to Paraswap's Augustus contract.
///         The off-chain component calls the Paraswap API (/transactions endpoint) to obtain
///         the calldata, which is passed as venueData through the MidcurveSwapRouter.
/// @dev    Token flow:
///         1. Router transfers tokens to this adapter
///         2. Adapter approves Paraswap's TokenTransferProxy
///         3. Adapter calls Augustus with the pre-built calldata
///         4. Augustus pulls tokens via TokenTransferProxy, executes the swap
///         5. Adapter forwards output tokens (and any refund) back to the router
///
///         Off-chain requirements:
///         - Call Paraswap /transactions with userAddress = this adapter's address
///         - The Paraswap calldata must route output tokens back to this adapter
///         - venueData = abi.encode(bytes paraswapCalldata)
contract ParaswapAdapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    // ============================================================================
    // Errors
    // ============================================================================

    error OnlyRouter();
    error ZeroAddress();
    error AugustusCallFailed(bytes reason);
    error InsufficientOutput(uint256 actual, uint256 expected);

    // ============================================================================
    // Immutables
    // ============================================================================

    /// @notice The MidcurveSwapRouter that is allowed to call this adapter
    address public immutable router;

    /// @notice Paraswap Augustus swapper contract
    address public immutable augustus;

    /// @notice Paraswap TokenTransferProxy — the spender that Augustus uses to pull tokens
    address public immutable tokenTransferProxy;

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyRouter() {
        if (msg.sender != router) revert OnlyRouter();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    /// @param router_ The MidcurveSwapRouter address
    /// @param augustus_ The Paraswap Augustus contract address
    /// @param tokenTransferProxy_ The Paraswap TokenTransferProxy address
    constructor(address router_, address augustus_, address tokenTransferProxy_) {
        if (router_ == address(0) || augustus_ == address(0) || tokenTransferProxy_ == address(0)) {
            revert ZeroAddress();
        }
        router = router_;
        augustus = augustus_;
        tokenTransferProxy = tokenTransferProxy_;
    }

    // ============================================================================
    // IVenueAdapter Implementation
    // ============================================================================

    /// @inheritdoc IVenueAdapter
    /// @dev venueData = abi.encode(bytes paraswapCalldata)
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes calldata venueData
    ) external onlyRouter returns (uint256 amountOut) {
        bytes memory paraswapCalldata = abi.decode(venueData, (bytes));

        // Snapshot output balance before swap
        uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));

        // Approve TokenTransferProxy to pull input tokens
        IERC20(tokenIn).forceApprove(tokenTransferProxy, amountIn);

        // Execute the swap via Augustus
        _callAugustus(paraswapCalldata);

        // Clear residual approval (defense-in-depth)
        IERC20(tokenIn).forceApprove(tokenTransferProxy, 0);

        // Measure output received
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - outBefore;

        // Transfer output to router
        IERC20(tokenOut).safeTransfer(router, amountOut);
    }

    /// @inheritdoc IVenueAdapter
    /// @dev venueData = abi.encode(bytes paraswapCalldata)
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 amountInMaximum,
        bytes calldata venueData
    ) external onlyRouter returns (uint256 amountIn) {
        bytes memory paraswapCalldata = abi.decode(venueData, (bytes));

        // Snapshot balances before swap
        uint256 inBefore = IERC20(tokenIn).balanceOf(address(this));
        uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));

        // Approve TokenTransferProxy to pull input tokens
        IERC20(tokenIn).forceApprove(tokenTransferProxy, amountInMaximum);

        // Execute the swap via Augustus
        _callAugustus(paraswapCalldata);

        // Clear residual approval (defense-in-depth)
        IERC20(tokenIn).forceApprove(tokenTransferProxy, 0);

        // Measure actual output
        uint256 actualOut = IERC20(tokenOut).balanceOf(address(this)) - outBefore;
        if (actualOut < amountOut) revert InsufficientOutput(actualOut, amountOut);

        // Measure actual input consumed
        amountIn = inBefore - IERC20(tokenIn).balanceOf(address(this));

        // Transfer exact output to router
        IERC20(tokenOut).safeTransfer(router, amountOut);

        // Refund any surplus output (Paraswap may overshoot slightly)
        uint256 surplusOut = actualOut - amountOut;
        if (surplusOut > 0) {
            IERC20(tokenOut).safeTransfer(router, surplusOut);
        }

        // Refund unused input tokens to router
        uint256 remainingIn = IERC20(tokenIn).balanceOf(address(this));
        if (remainingIn > 0) {
            IERC20(tokenIn).safeTransfer(router, remainingIn);
        }
    }

    // ============================================================================
    // Internal
    // ============================================================================

    /// @dev Low-level call to Augustus. Reverts with the original error on failure.
    function _callAugustus(bytes memory data) internal {
        (bool success, bytes memory returnData) = augustus.call(data);
        if (!success) revert AugustusCallFailed(returnData);
    }
}
