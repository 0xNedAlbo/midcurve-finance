// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFunding
 * @notice Interface for user-initiated funding operations (deposits and withdrawals)
 * @dev Strategies implement this interface to support funding from external chains.
 *
 * Fund Flow:
 * - Deposits: User transfers tokens to automation wallet on external chain
 *             → Core detects transfer → updates BalanceStore → calls onErc20Deposit/onEthBalanceUpdated
 * - Withdrawals: User calls withdraw function → strategy emits event
 *                → Core executes transfer on external chain → updates BalanceStore → calls onWithdrawComplete
 *
 * Security:
 * - withdraw* and updateEthBalance functions: onlyOwner
 * - on* callback functions: onlyCore
 */
interface IFunding {
    // ============= Events (Strategy -> Core requests) =============

    /// @notice Emitted when owner requests ERC-20 token withdrawal
    /// @param requestId Unique identifier for tracking this request
    /// @param chainId The chain where tokens should be transferred
    /// @param token The ERC-20 token address on the target chain
    /// @param amount The amount of tokens to withdraw (in token decimals)
    /// @param recipient The address to receive tokens (always the owner)
    event Erc20WithdrawRequested(
        bytes32 indexed requestId,
        uint256 indexed chainId,
        address indexed token,
        uint256 amount,
        address recipient
    );

    /// @notice Emitted when owner requests native ETH withdrawal
    /// @param requestId Unique identifier for tracking this request
    /// @param chainId The chain where ETH should be transferred
    /// @param amount The amount of ETH to withdraw (in wei)
    /// @param recipient The address to receive ETH (always the owner)
    event EthWithdrawRequested(
        bytes32 indexed requestId,
        uint256 indexed chainId,
        uint256 amount,
        address recipient
    );

    /// @notice Emitted when owner requests ETH balance update
    /// @dev Used to sync ETH balance after user sends ETH to automation wallet
    /// @param requestId Unique identifier for tracking this request
    /// @param chainId The chain to poll ETH balance from
    event EthBalanceUpdateRequested(
        bytes32 indexed requestId,
        uint256 indexed chainId
    );

    // ============= Withdraw Functions (Owner Only) =============

    /// @notice Request withdrawal of ERC-20 tokens to owner wallet
    /// @dev Emits Erc20WithdrawRequested event for Core to process
    /// @param chainId The chain where tokens are held
    /// @param token The ERC-20 token address
    /// @param amount The amount to withdraw
    /// @return requestId Unique identifier for tracking this request
    function withdrawErc20(
        uint256 chainId,
        address token,
        uint256 amount
    ) external returns (bytes32 requestId);

    /// @notice Request withdrawal of native ETH to owner wallet
    /// @dev Emits EthWithdrawRequested event for Core to process
    /// @param chainId The chain where ETH is held
    /// @param amount The amount to withdraw (in wei)
    /// @return requestId Unique identifier for tracking this request
    function withdrawEth(
        uint256 chainId,
        uint256 amount
    ) external returns (bytes32 requestId);

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
    /// @dev BalanceStore is updated BEFORE this callback is invoked
    /// @param requestId The original request identifier
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
