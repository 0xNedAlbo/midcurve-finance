// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStrategy
 * @notice Base interface for all SEMSEE strategies
 * @dev All strategies must implement this interface to be deployable in SEMSEE
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

    /// @notice Returns the owner address of the strategy (the deployer)
    /// @return The address that owns this strategy (can call onlyOwner functions)
    function owner() external view returns (address);

    /// @notice Returns the current lifecycle state
    /// @return The current StrategyState
    function state() external view returns (StrategyState);

    /// @notice Start the strategy (only owner, only from Created state)
    /// @dev Creates subscriptions and begins receiving callbacks
    function start() external;

    /// @notice Shutdown the strategy (only owner, only from Running state)
    /// @dev Removes all subscriptions. Cannot be restarted.
    function shutdown() external;
}
