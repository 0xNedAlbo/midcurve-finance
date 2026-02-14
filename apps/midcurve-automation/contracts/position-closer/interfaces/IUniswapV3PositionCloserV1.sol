// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TriggerMode, SwapDirection, CloseOrder} from "../storage/AppStorage.sol";

/// @title IUniswapV3PositionCloserV1
/// @notice Versioned interface for UniswapV3 Position Closer Diamond (V1)
/// @dev V1 introduces tick-based triggers with LOWER/UPPER modes,
///      and enforces 1 order per trigger mode per position
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
        TriggerMode triggerMode;    // LOWER or UPPER
        int24 triggerTick;          // Price threshold as tick
        address payout;             // Recipient of closed tokens
        address operator;           // Automation wallet
        uint256 validUntil;         // Expiration timestamp (0 = no expiry)
        uint16 slippageBps;         // Decrease liquidity slippage (0-10000)
        // Swap configuration (optional)
        SwapDirection swapDirection;    // NONE, TOKEN0_TO_1, or TOKEN1_TO_0
        uint16 swapSlippageBps;         // Swap slippage (0-10000)
    }

    /// @notice Register a new close order
    /// @dev Caller must be the NFT owner and must have approved this contract
    /// @param params Registration parameters
    function registerOrder(RegisterOrderParams calldata params) external;

    /// @notice Cancel an existing close order
    /// @dev Only the NFT owner can cancel
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode to cancel
    function cancelOrder(uint256 nftId, TriggerMode triggerMode) external;

    // ========================================
    // EXECUTION
    // ========================================

    /// @notice Parameters for swap execution
    /// @dev When augustus == address(0), the contract executes a direct pool swap (fallback mode)
    ///      instead of routing through Paraswap. In this mode, swapCalldata and deadline are ignored,
    ///      and minAmountOut provides slippage protection against the pool price.
    struct SwapParams {
        address augustus;           // AugustusSwapper address (verified against registry), or address(0) for direct pool swap
        bytes swapCalldata;         // Fresh calldata from Paraswap API (ignored when augustus == address(0))
        uint256 deadline;           // Swap deadline (0 = no deadline, ignored when augustus == address(0))
        uint256 minAmountOut;       // Minimum output amount (slippage protection, used in both modes)
    }

    /// @notice Execute a close order when trigger condition is met
    /// @dev Only the registered operator can execute
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode to execute
    /// @param feeRecipient Recipient of operator fee (address(0) = no fee)
    /// @param feeBps Fee in basis points (capped by maxFeeBps)
    /// @param swapParams Swap parameters (required if swap was configured)
    function executeOrder(
        uint256 nftId,
        TriggerMode triggerMode,
        address feeRecipient,
        uint16 feeBps,
        SwapParams calldata swapParams
    ) external;

    // ========================================
    // OWNER UPDATES
    // ========================================

    /// @notice Update the operator for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newOperator The new operator address
    function setOperator(uint256 nftId, TriggerMode triggerMode, address newOperator) external;

    /// @notice Update the payout address for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newPayout The new payout address
    function setPayout(uint256 nftId, TriggerMode triggerMode, address newPayout) external;

    /// @notice Update the trigger tick for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newTriggerTick The new trigger tick
    function setTriggerTick(uint256 nftId, TriggerMode triggerMode, int24 newTriggerTick) external;

    /// @notice Update the expiration for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newValidUntil The new expiration timestamp (0 = no expiry)
    function setValidUntil(uint256 nftId, TriggerMode triggerMode, uint256 newValidUntil) external;

    /// @notice Update the slippage for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param newSlippageBps The new slippage in basis points
    function setSlippage(uint256 nftId, TriggerMode triggerMode, uint16 newSlippageBps) external;

    /// @notice Update the swap configuration for an order
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @param direction The new swap direction (TOKEN0_TO_1 or TOKEN1_TO_0)
    /// @param swapSlippageBps The swap slippage in basis points
    function setSwapIntent(
        uint256 nftId,
        TriggerMode triggerMode,
        SwapDirection direction,
        uint16 swapSlippageBps
    ) external;

    // ========================================
    // VIEWS
    // ========================================

    /// @notice Get the full order details
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @return order The close order data
    function getOrder(uint256 nftId, TriggerMode triggerMode) external view returns (CloseOrder memory order);

    /// @notice Check if an order exists
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @return exists True if order exists
    function hasOrder(uint256 nftId, TriggerMode triggerMode) external view returns (bool exists);

    /// @notice Check if an order can be executed (status, expiry, trigger)
    /// @param nftId The position NFT ID
    /// @param triggerMode The trigger mode
    /// @return canExecute True if order can be executed now
    function canExecuteOrder(uint256 nftId, TriggerMode triggerMode) external view returns (bool canExecute);

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
        TriggerMode indexed triggerMode,
        address indexed owner,
        address pool,
        address operator,
        address payout,
        int24 triggerTick,
        uint256 validUntil,
        uint16 slippageBps,
        SwapDirection swapDirection,
        uint16 swapSlippageBps
    );

    /// @notice Emitted when an order is executed
    event OrderExecuted(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address payout,
        int24 executionTick,
        uint256 amount0Out,
        uint256 amount1Out
    );

    /// @notice Emitted when an order is cancelled
    event OrderCancelled(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address indexed owner
    );

    /// @notice Emitted when operator is updated
    event OrderOperatorUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address oldOperator,
        address newOperator
    );

    /// @notice Emitted when payout address is updated
    event OrderPayoutUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address oldPayout,
        address newPayout
    );

    /// @notice Emitted when trigger tick is updated
    event OrderTriggerTickUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        int24 oldTick,
        int24 newTick
    );

    /// @notice Emitted when expiration is updated
    event OrderValidUntilUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        uint256 oldValidUntil,
        uint256 newValidUntil
    );

    /// @notice Emitted when slippage is updated
    event OrderSlippageUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        uint16 oldSlippageBps,
        uint16 newSlippageBps
    );

    /// @notice Emitted when swap intent is updated
    event OrderSwapIntentUpdated(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        SwapDirection oldDirection,
        SwapDirection newDirection,
        uint16 swapSlippageBps
    );

    /// @notice Emitted when fee is applied during execution
    event FeeApplied(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address indexed feeRecipient,
        uint16 feeBps,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    /// @notice Emitted when post-close swap is executed via Paraswap
    event SwapExecuted(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    /// @notice Emitted when post-close swap is executed via direct pool swap (fallback)
    event PoolSwapExecuted(
        uint256 indexed nftId,
        TriggerMode indexed triggerMode,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
}
