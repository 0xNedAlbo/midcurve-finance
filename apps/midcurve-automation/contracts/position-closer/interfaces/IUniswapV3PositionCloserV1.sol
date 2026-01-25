// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OrderType, SwapDirection, CloseOrder} from "../storage/AppStorage.sol";

/// @title IUniswapV3PositionCloserV1
/// @notice Versioned interface for UniswapV3 Position Closer Diamond (V1)
/// @dev V1 introduces tick-based triggers, simplified order types (SL/TP only),
///      and enforces 1 order per type per position
interface IUniswapV3PositionCloserV1 {
    // ========================================
    // VERSION
    // ========================================

    /// @notice Returns the interface version
    /// @return Version number (e.g., 1_00 = v1.0)
    function interfaceVersion() external view returns (uint32);

    /// @notice Returns the implementation version string
    /// @return Human-readable version string
    function version() external pure returns (string memory);

    // ========================================
    // REGISTRATION
    // ========================================

    /// @notice Parameters for registering a close order
    struct RegisterOrderParams {
        uint256 nftId;              // Position NFT ID
        address pool;               // Uniswap V3 pool address
        OrderType orderType;        // STOP_LOSS or TAKE_PROFIT
        int24 triggerTick;          // Price threshold as tick
        address payout;             // Recipient of closed tokens
        address operator;           // Automation wallet
        uint256 validUntil;         // Expiration timestamp (0 = no expiry)
        uint16 slippageBps;         // Decrease liquidity slippage (0-10000)
        // Swap configuration (optional)
        SwapDirection swapDirection;    // NONE, BASE_TO_QUOTE, or QUOTE_TO_BASE
        address swapQuoteToken;         // Quote token address (required if swapping)
        uint16 swapSlippageBps;         // Swap slippage (0-10000)
    }

    /// @notice Register a new close order
    /// @dev Caller must be the NFT owner and must have approved this contract
    /// @param params Registration parameters
    function registerOrder(RegisterOrderParams calldata params) external;

    /// @notice Cancel an existing close order
    /// @dev Only the NFT owner can cancel
    /// @param nftId The position NFT ID
    /// @param orderType The order type to cancel
    function cancelOrder(uint256 nftId, OrderType orderType) external;

    // ========================================
    // EXECUTION
    // ========================================

    /// @notice Parameters for swap execution
    struct SwapParams {
        address augustus;           // AugustusSwapper address (verified against registry)
        bytes swapCalldata;         // Fresh calldata from Paraswap API
        uint256 deadline;           // Swap deadline (0 = no deadline)
        uint256 minAmountOut;       // Minimum output amount (slippage protection)
    }

    /// @notice Execute a close order when trigger condition is met
    /// @dev Only the registered operator can execute
    /// @param nftId The position NFT ID
    /// @param orderType The order type to execute
    /// @param feeRecipient Recipient of operator fee (address(0) = no fee)
    /// @param feeBps Fee in basis points (capped by maxFeeBps)
    /// @param swapParams Swap parameters (required if swap was configured)
    function executeOrder(
        uint256 nftId,
        OrderType orderType,
        address feeRecipient,
        uint16 feeBps,
        SwapParams calldata swapParams
    ) external;

    // ========================================
    // OWNER UPDATES
    // ========================================

    /// @notice Update the operator for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param newOperator The new operator address
    function setOperator(uint256 nftId, OrderType orderType, address newOperator) external;

    /// @notice Update the payout address for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param newPayout The new payout address
    function setPayout(uint256 nftId, OrderType orderType, address newPayout) external;

    /// @notice Update the trigger tick for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param newTriggerTick The new trigger tick
    function setTriggerTick(uint256 nftId, OrderType orderType, int24 newTriggerTick) external;

    /// @notice Update the expiration for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param newValidUntil The new expiration timestamp (0 = no expiry)
    function setValidUntil(uint256 nftId, OrderType orderType, uint256 newValidUntil) external;

    /// @notice Update the slippage for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param newSlippageBps The new slippage in basis points
    function setSlippage(uint256 nftId, OrderType orderType, uint16 newSlippageBps) external;

    /// @notice Update the swap configuration for an order
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @param direction The new swap direction
    /// @param quoteToken The quote token address
    /// @param swapSlippageBps The swap slippage in basis points
    function setSwapIntent(
        uint256 nftId,
        OrderType orderType,
        SwapDirection direction,
        address quoteToken,
        uint16 swapSlippageBps
    ) external;

    // ========================================
    // VIEWS
    // ========================================

    /// @notice Get the full order details
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @return order The close order data
    function getOrder(uint256 nftId, OrderType orderType) external view returns (CloseOrder memory order);

    /// @notice Check if an order exists
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @return exists True if order exists
    function hasOrder(uint256 nftId, OrderType orderType) external view returns (bool exists);

    /// @notice Check if an order can be executed (status, expiry, trigger)
    /// @param nftId The position NFT ID
    /// @param orderType The order type
    /// @return canExecute True if order can be executed now
    function canExecuteOrder(uint256 nftId, OrderType orderType) external view returns (bool canExecute);

    /// @notice Get the current tick from a pool
    /// @param pool The pool address
    /// @return tick The current tick
    function getCurrentTick(address pool) external view returns (int24 tick);

    /// @notice Get the position manager address
    /// @return The NonfungiblePositionManager address
    function positionManager() external view returns (address);

    /// @notice Get the Augustus registry address
    /// @return The Paraswap AugustusRegistry address
    function augustusRegistry() external view returns (address);

    /// @notice Get the maximum fee in basis points
    /// @return The max fee bps (e.g., 100 = 1%)
    function maxFeeBps() external view returns (uint16);

    // ========================================
    // EVENTS
    // ========================================

    /// @notice Emitted when an order is registered
    event OrderRegistered(
        uint256 indexed nftId,
        OrderType indexed orderType,
        address indexed owner,
        address pool,
        address operator,
        address payout,
        int24 triggerTick,
        uint256 validUntil,
        uint16 slippageBps
    );

    /// @notice Emitted when an order is executed
    event OrderExecuted(
        uint256 indexed nftId,
        OrderType indexed orderType,
        address indexed owner,
        address payout,
        int24 executionTick,
        uint256 amount0Out,
        uint256 amount1Out
    );

    /// @notice Emitted when an order is cancelled
    event OrderCancelled(
        uint256 indexed nftId,
        OrderType indexed orderType,
        address indexed owner
    );

    /// @notice Emitted when operator is updated
    event OrderOperatorUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        address oldOperator,
        address newOperator
    );

    /// @notice Emitted when payout address is updated
    event OrderPayoutUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        address oldPayout,
        address newPayout
    );

    /// @notice Emitted when trigger tick is updated
    event OrderTriggerTickUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        int24 oldTick,
        int24 newTick
    );

    /// @notice Emitted when expiration is updated
    event OrderValidUntilUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        uint256 oldValidUntil,
        uint256 newValidUntil
    );

    /// @notice Emitted when slippage is updated
    event OrderSlippageUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        uint16 oldSlippageBps,
        uint16 newSlippageBps
    );

    /// @notice Emitted when swap intent is updated
    event OrderSwapIntentUpdated(
        uint256 indexed nftId,
        OrderType indexed orderType,
        SwapDirection oldDirection,
        SwapDirection newDirection
    );

    /// @notice Emitted when fee is applied during execution
    event FeeApplied(
        uint256 indexed nftId,
        OrderType indexed orderType,
        address indexed feeRecipient,
        uint16 feeBps,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    /// @notice Emitted when post-close swap is executed
    event SwapExecuted(
        uint256 indexed nftId,
        OrderType indexed orderType,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
}
