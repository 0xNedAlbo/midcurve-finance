// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TriggerMode, SwapDirection, VaultCloseOrder} from "../storage/AppStorage.sol";
import {IMidcurveSwapRouter} from "../../swap-router/interfaces/IMidcurveSwapRouter.sol";

/// @title IUniswapV3VaultPositionCloserV1
/// @notice Versioned interface for UniswapV3 Vault Position Closer Diamond (V1)
/// @dev V1 introduces tick-based triggers with LOWER/UPPER modes for vault share holders.
///      Enforces 1 order per trigger mode per user per vault.
interface IUniswapV3VaultPositionCloserV1 {
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

    /// @notice Parameters for registering a vault close order
    struct RegisterOrderParams {
        address vault;              // UniswapV3Vault address
        TriggerMode triggerMode;    // LOWER or UPPER
        uint256 shares;             // 0 = close all at execution, >0 = exact amount
        int24 triggerTick;          // Price threshold as tick
        address payout;             // Recipient of closed tokens
        address operator;           // Automation wallet
        uint256 validUntil;         // Expiration timestamp (0 = no expiry)
        uint16 slippageBps;         // Decrease liquidity slippage (0-10000)
        // Swap configuration (optional)
        SwapDirection swapDirection;    // NONE, TOKEN0_TO_1, or TOKEN1_TO_0
        uint16 swapSlippageBps;         // Swap slippage (0-10000)
    }

    /// @notice Register a new vault close order
    /// @dev Caller must hold vault shares and have approved this contract
    /// @param params Registration parameters
    function registerOrder(RegisterOrderParams calldata params) external;

    /// @notice Cancel an existing vault close order
    /// @dev Only the order owner (msg.sender) can cancel
    /// @param vault The vault address
    /// @param triggerMode The trigger mode to cancel
    function cancelOrder(address vault, TriggerMode triggerMode) external;

    // ========================================
    // EXECUTION
    // ========================================

    /// @notice Parameters for withdrawal slippage (computed off-chain)
    /// @dev Maps to BurnParams.minAmounts in the vault's burn() call
    struct WithdrawParams {
        uint256 amount0Min;    // Minimum amount of token0 from vault burn
        uint256 amount1Min;    // Minimum amount of token1 from vault burn
    }

    /// @notice Parameters for two-phase swap execution via MidcurveSwapRouter
    struct SwapParams {
        uint256 guaranteedAmountIn;            // Guaranteed min from withdrawal (after fees), sent through hops
        uint256 minAmountOut;                  // Minimum output from quote for guaranteedAmountIn
        uint256 deadline;                      // Swap deadline (0 = no deadline, applies to both phases)
        IMidcurveSwapRouter.Hop[] hops;        // Adapter hop(s) for guaranteed portion
    }

    /// @notice Parameters for operator fee application
    struct FeeParams {
        address feeRecipient;  // Recipient of operator fee (address(0) = no fee)
        uint16 feeBps;         // Fee in basis points (capped by maxFeeBps)
    }

    /// @notice Execute a vault close order when trigger condition is met
    /// @dev Only the registered operator can execute.
    /// @param vault The vault address
    /// @param owner The share holder whose order to execute
    /// @param triggerMode The trigger mode to execute
    /// @param withdrawParams Withdrawal slippage params computed off-chain
    /// @param swapParams Two-phase swap parameters (required if swap was configured)
    /// @param feeParams Operator fee parameters
    function executeOrder(
        address vault,
        address owner,
        TriggerMode triggerMode,
        WithdrawParams calldata withdrawParams,
        SwapParams calldata swapParams,
        FeeParams calldata feeParams
    ) external;

    // ========================================
    // OWNER UPDATES
    // ========================================

    /// @notice Update the operator for an order
    function setOperator(address vault, TriggerMode triggerMode, address newOperator) external;

    /// @notice Update the payout address for an order
    function setPayout(address vault, TriggerMode triggerMode, address newPayout) external;

    /// @notice Update the trigger tick for an order
    function setTriggerTick(address vault, TriggerMode triggerMode, int24 newTriggerTick) external;

    /// @notice Update the expiration for an order
    function setValidUntil(address vault, TriggerMode triggerMode, uint256 newValidUntil) external;

    /// @notice Update the slippage for an order
    function setSlippage(address vault, TriggerMode triggerMode, uint16 newSlippageBps) external;

    /// @notice Update the swap configuration for an order
    function setSwapIntent(
        address vault,
        TriggerMode triggerMode,
        SwapDirection direction,
        uint16 swapSlippageBps
    ) external;

    /// @notice Update the share amount for an order
    function setShares(address vault, TriggerMode triggerMode, uint256 newShares) external;

    // ========================================
    // MULTICALL
    // ========================================

    /// @notice Execute multiple calls in a single transaction
    /// @dev Sub-calls that use nonReentrant will revert if invoked via multicall.
    ///      Intended for batching owner updates and view calls.
    /// @param data Array of ABI-encoded function calls
    /// @return results Array of ABI-encoded return values
    function multicall(bytes[] calldata data) external returns (bytes[] memory results);

    // ========================================
    // VIEWS
    // ========================================

    /// @notice Get the full order details
    function getOrder(address vault, address owner, TriggerMode triggerMode)
        external view returns (VaultCloseOrder memory order);

    /// @notice Check if an order exists
    function hasOrder(address vault, address owner, TriggerMode triggerMode)
        external view returns (bool exists);

    /// @notice Check if an order can be executed (status, expiry, trigger)
    function canExecuteOrder(address vault, address owner, TriggerMode triggerMode)
        external view returns (bool canExecute);

    /// @notice Get the current tick from a pool
    function getCurrentTick(address pool) external view returns (int24 tick);

    /// @notice Get the MidcurveSwapRouter address
    function swapRouter() external view returns (address);

    /// @notice Get the maximum fee in basis points
    function maxFeeBps() external view returns (uint16);

    // ========================================
    // EVENTS
    // ========================================

    event OrderRegistered(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address pool,
        address operator,
        address payout,
        int24 triggerTick,
        uint256 shares,
        uint256 validUntil,
        uint16 slippageBps,
        SwapDirection swapDirection,
        uint16 swapSlippageBps
    );

    event OrderExecuted(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address payout,
        int24 executionTick,
        uint256 sharesClosed,
        uint256 amount0Out,
        uint256 amount1Out
    );

    event OrderCancelled(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner
    );

    event OrderOperatorUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address oldOperator,
        address newOperator
    );

    event OrderPayoutUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        address oldPayout,
        address newPayout
    );

    event OrderTriggerTickUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        int24 oldTick,
        int24 newTick
    );

    event OrderValidUntilUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        uint256 oldValidUntil,
        uint256 newValidUntil
    );

    event OrderSlippageUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        uint16 oldSlippageBps,
        uint16 newSlippageBps
    );

    event OrderSwapIntentUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        SwapDirection oldDirection,
        SwapDirection newDirection,
        uint16 swapSlippageBps
    );

    event OrderSharesUpdated(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed owner,
        uint256 oldShares,
        uint256 newShares
    );

    event FeeApplied(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address indexed feeRecipient,
        uint16 feeBps,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    event SwapExecuted(
        address indexed vault,
        TriggerMode indexed triggerMode,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
}
