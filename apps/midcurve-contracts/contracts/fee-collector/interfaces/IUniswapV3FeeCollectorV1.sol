// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SwapDirection, CollectOrder} from "../storage/AppStorage.sol";
import {IMidcurveSwapRouter} from "../../swap-router/interfaces/IMidcurveSwapRouter.sol";

/// @title IUniswapV3FeeCollectorV1
/// @notice Versioned interface for UniswapV3 Fee Collector Diamond (V1)
/// @dev V1 introduces recurring fee collection with configurable minimum thresholds
///      and optional post-collect token swaps
interface IUniswapV3FeeCollectorV1 {
    // ========================================
    // VERSION
    // ========================================

    function interfaceVersion() external view returns (uint32);
    function version() external pure returns (string memory);

    // ========================================
    // REGISTRATION
    // ========================================

    /// @notice Parameters for registering a collect order
    struct RegisterCollectParams {
        uint256 nftId;              // Position NFT ID
        address pool;               // Uniswap V3 pool address
        address payout;             // Recipient of collected tokens
        address operator;           // Automation wallet
        uint256 validUntil;         // Expiration timestamp (0 = no expiry)
        SwapDirection swapDirection;    // NONE, TOKEN0_TO_1, or TOKEN1_TO_0
        uint16 swapSlippageBps;         // Swap slippage (0-10000, ignored when NONE)
        address minFeeToken;        // Token to measure minimum fee value in (must be token0 or token1)
        uint256 minFeeValue;        // Minimum fee threshold in minFeeToken units
    }

    /// @notice Register a new collect order
    /// @dev Caller must be the NFT owner and must have approved this contract
    function registerCollect(RegisterCollectParams calldata params) external;

    /// @notice Cancel an existing collect order
    /// @dev Only the NFT owner can cancel
    function cancelCollect(uint256 nftId) external;

    // ========================================
    // EXECUTION
    // ========================================

    /// @notice Parameters for swap execution via MidcurveSwapRouter
    struct CollectSwapParams {
        uint256 minAmountOut;              // Slippage protection for the swap
        uint256 deadline;                  // Swap deadline (0 = no deadline)
        IMidcurveSwapRouter.Hop[] hops;    // Swap route
    }

    /// @notice Parameters for operator fee application
    struct CollectFeeParams {
        address feeRecipient;  // Recipient of operator fee (address(0) = no fee)
        uint16 feeBps;         // Fee in basis points (capped by maxFeeBps)
    }

    /// @notice Execute fee collection for a position
    /// @dev Only the registered operator can execute.
    ///      Collects all accrued fees, checks minimum threshold using pool spot price,
    ///      applies operator fee, optionally swaps, and transfers to payout address.
    ///      Order remains ACTIVE after execution (recurring).
    function executeCollect(
        uint256 nftId,
        CollectSwapParams calldata swapParams,
        CollectFeeParams calldata feeParams
    ) external;

    // ========================================
    // OWNER UPDATES
    // ========================================

    function setCollectOperator(uint256 nftId, address newOperator) external;
    function setCollectPayout(uint256 nftId, address newPayout) external;
    function setCollectValidUntil(uint256 nftId, uint256 newValidUntil) external;
    function setCollectSwapIntent(uint256 nftId, SwapDirection direction, uint16 swapSlippageBps) external;
    function setCollectMinFee(uint256 nftId, address minFeeToken, uint256 newMinFeeValue) external;

    // ========================================
    // MULTICALL
    // ========================================

    /// @notice Execute multiple calls in a single transaction
    /// @dev Sub-calls that use nonReentrant will revert if invoked via multicall.
    ///      Intended for batching owner updates and view calls.
    function multicall(bytes[] calldata data) external returns (bytes[] memory results);

    // ========================================
    // VIEWS
    // ========================================

    function getCollectOrder(uint256 nftId) external view returns (CollectOrder memory order);
    function hasCollectOrder(uint256 nftId) external view returns (bool exists);
    function positionManager() external view returns (address);
    function swapRouter() external view returns (address);
    function maxFeeBps() external view returns (uint16);

    // ========================================
    // EVENTS
    // ========================================

    event CollectRegistered(
        uint256 indexed nftId,
        address indexed owner,
        address pool,
        address operator,
        address payout,
        uint256 validUntil,
        SwapDirection swapDirection,
        uint16 swapSlippageBps,
        address minFeeToken,
        uint256 minFeeValue
    );

    event CollectExecuted(
        uint256 indexed nftId,
        address indexed payout,
        uint256 amount0Out,
        uint256 amount1Out
    );

    event CollectCancelled(
        uint256 indexed nftId,
        address indexed owner
    );

    event CollectOperatorUpdated(
        uint256 indexed nftId,
        address oldOperator,
        address newOperator
    );

    event CollectPayoutUpdated(
        uint256 indexed nftId,
        address oldPayout,
        address newPayout
    );

    event CollectValidUntilUpdated(
        uint256 indexed nftId,
        uint256 oldValidUntil,
        uint256 newValidUntil
    );

    event CollectSwapIntentUpdated(
        uint256 indexed nftId,
        SwapDirection oldDirection,
        SwapDirection newDirection,
        uint16 swapSlippageBps
    );

    event CollectMinFeeUpdated(
        uint256 indexed nftId,
        address oldToken,
        address newToken,
        uint256 oldValue,
        uint256 newValue
    );

    event CollectFeeApplied(
        uint256 indexed nftId,
        address indexed feeRecipient,
        uint16 feeBps,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    event CollectSwapExecuted(
        uint256 indexed nftId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
}
