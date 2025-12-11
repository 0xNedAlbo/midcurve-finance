// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStrategy
 * @notice Base interface for all SEMSEE strategies
 * @dev All strategies must implement this interface to be deployable in SEMSEE
 *
 * Authorization Model:
 * - Owner is set at deployment (immutable)
 * - All owner actions require EIP-712 signature verification
 * - Users sign on Ethereum mainnet (chainId: 1), no network switch needed
 * - Automation wallet submits signed transactions to SEMSEE chain
 *
 * Lifecycle: Created -> Running -> Shutdown
 * - Created: After deployment, before start() is called
 * - Running: Active, receiving callbacks and emitting actions
 * - Shutdown: Permanently stopped, cannot be restarted
 */
interface IStrategy {
    /// @notice Strategy lifecycle states
    enum StrategyState { Created, Running, Shutdown }

    /// @notice Emitted when strategy starts
    event StrategyStarted();

    /// @notice Emitted when strategy shuts down
    event StrategyShutdown();

    /// @notice Returns the owner address of the strategy (user's EOA)
    /// @return The address that owns this strategy (must sign actions)
    function owner() external view returns (address);

    /// @notice Returns the current lifecycle state
    /// @return The current StrategyState
    function state() external view returns (StrategyState);

    /// @notice Start the strategy with owner signature
    /// @dev Creates subscriptions and begins receiving callbacks
    /// @param signature EIP-712 signature from owner
    /// @param nonce Timestamp-based nonce for replay protection
    /// @param expiry Signature expiry timestamp
    function start(bytes calldata signature, uint256 nonce, uint256 expiry) external;

    /// @notice Shutdown the strategy with owner signature
    /// @dev Removes all subscriptions. Cannot be restarted.
    /// @param signature EIP-712 signature from owner
    /// @param nonce Timestamp-based nonce for replay protection
    /// @param expiry Signature expiry timestamp
    function shutdown(bytes calldata signature, uint256 nonce, uint256 expiry) external;
}
