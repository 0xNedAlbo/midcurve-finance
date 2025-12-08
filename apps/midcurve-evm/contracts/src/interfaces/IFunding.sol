// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFunding
 * @notice Interface for user-initiated funding operations (deposits and withdrawals)
 * @dev Strategies implement this interface to support funding from external chains.
 *
 * Fund Flow:
 * - Deposits: User transfers tokens to automation wallet on external chain
 *             -> Core detects transfer -> updates BalanceStore -> calls onErc20Deposit/onEthBalanceUpdated
 * - Withdrawals: Owner signs withdrawal request (EIP-712) via CLI
 *                -> CLI submits to Core -> Core verifies signature
 *                -> Core executes transfer on external chain -> updates BalanceStore
 *                -> Core calls onWithdrawComplete if strategy is Running
 *
 * Security:
 * - updateEthBalance: onlyOwner (strategy-initiated)
 * - Withdrawals: Owner signature verification (CLI-initiated, off-chain)
 * - on* callback functions: onlyCore
 */
interface IFunding {
    // ============= Events (Strategy -> Core requests) =============

    /// @notice Emitted when owner requests ETH balance update
    /// @dev Used to sync ETH balance after user sends ETH to automation wallet
    /// @param requestId Unique identifier for tracking this request
    /// @param chainId The chain to poll ETH balance from
    event EthBalanceUpdateRequested(
        bytes32 indexed requestId,
        uint256 indexed chainId
    );

    // ============= Balance Update Functions (Owner Only) =============

    /// @notice Request Core to poll and update ETH balance
    /// @dev Use after sending ETH to automation wallet on external chain.
    ///      Native ETH transfers don't emit Transfer events, so we need
    ///      explicit balance polling.
    /// @param chainId The chain to poll ETH balance from
    /// @return requestId Unique identifier for tracking this request
    function updateEthBalance(uint256 chainId) external returns (bytes32 requestId);

    // ============= Callbacks (Core Only) =============

    /// @notice Called by Core when ERC-20 deposit detected on external chain
    /// @dev BalanceStore is updated BEFORE this callback is invoked
    /// @param chainId The chain where deposit was detected
    /// @param token The ERC-20 token address
    /// @param amount The amount deposited
    function onErc20Deposit(
        uint256 chainId,
        address token,
        uint256 amount
    ) external;

    /// @notice Called by Core when ETH balance is updated
    /// @dev BalanceStore is updated BEFORE this callback is invoked
    /// @param chainId The chain where balance was polled
    /// @param balance The current ETH balance
    function onEthBalanceUpdated(
        uint256 chainId,
        uint256 balance
    ) external;

    /// @notice Called by Core when withdrawal completes on external chain
    /// @dev BalanceStore is updated BEFORE this callback is invoked.
    ///      This is only called when strategy is Running.
    /// @param requestId The request identifier (hash of signed withdrawal message)
    /// @param success Whether the withdrawal succeeded
    /// @param txHash The transaction hash on the external chain (0x0 if failed)
    /// @param errorMessage Error description if failed, empty if success
    function onWithdrawComplete(
        bytes32 requestId,
        bool success,
        bytes32 txHash,
        string calldata errorMessage
    ) external;
}
