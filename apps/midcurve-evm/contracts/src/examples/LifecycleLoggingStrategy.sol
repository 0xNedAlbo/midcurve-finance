// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseStrategy } from "../strategy/BaseStrategy.sol";
import { LifecycleMixin } from "../strategy/mixins/LifecycleMixin.sol";
import { LoggingMixin } from "../strategy/mixins/LoggingMixin.sol";

/// @title LifecycleLoggingStrategy
/// @notice Example strategy demonstrating lifecycle events with logging.
///
/// This strategy is designed to test the start/shutdown lifecycle functionality:
/// - Logs when the strategy is started (with timestamp)
/// - Logs when shutdown is requested (with uptime statistics)
/// - Logs cleanup progress during shutdown
/// - Logs when shutdown is complete
///
/// Use this contract to verify that:
/// 1. The Start button correctly triggers LIFECYCLE_START
/// 2. The Shutdown button correctly triggers LIFECYCLE_SHUTDOWN
/// 3. Lifecycle hooks are called in the correct order
/// 4. Log entries appear in the strategy logs UI
///
/// Inheritance: LifecycleMixin -> LoggingMixin -> BaseStrategy
/// - LifecycleMixin handles STEP_EVENT_LIFECYCLE (START/SHUTDOWN)
/// - LoggingMixin provides _log* helpers
/// - Both extend BaseStrategy
contract LifecycleLoggingStrategy is LifecycleMixin, LoggingMixin {
    // =============================================================
    // Constants
    // =============================================================

    /// @dev Topic constant for lifecycle-related log entries
    bytes32 private constant TOPIC_LIFECYCLE = keccak256("LIFECYCLE");

    /// @dev Topic constant for startup-related log entries
    bytes32 private constant TOPIC_STARTUP = keccak256("STARTUP");

    /// @dev Topic constant for shutdown progress entries
    bytes32 private constant TOPIC_SHUTDOWN_PROGRESS = keccak256("SHUTDOWN_PROGRESS");

    // =============================================================
    // State
    // =============================================================

    /// @notice Timestamp when the strategy was started
    uint256 public startedAt;

    /// @notice Counter tracking how many step events have been processed
    uint256 public eventsProcessed;

    // =============================================================
    // Constructor
    // =============================================================

    /// @param operator_ Address that can control this strategy
    /// @param core_ Address of the Core contract
    constructor(address operator_, address core_)
        BaseStrategy(operator_, core_) {}

    // =============================================================
    // Lifecycle Hooks
    // =============================================================

    /// @notice Called when the strategy receives the START command.
    /// @dev Logs the startup with a timestamp for tracking uptime.
    function onStart() internal override {
        startedAt = block.timestamp;

        // Log startup with timestamp
        _logInfo(
            TOPIC_STARTUP,
            abi.encode("Strategy started", startedAt)
        );

        // Log the lifecycle state transition
        _logInfo(
            TOPIC_LIFECYCLE,
            abi.encode("Transitioned to ACTIVE state")
        );
    }

    /// @notice Called when the strategy receives the SHUTDOWN command.
    /// @dev Logs the shutdown request with uptime statistics.
    function onShutdownRequested() internal override {
        uint256 uptime = block.timestamp - startedAt;

        // Log shutdown request with statistics
        _logInfo(
            TOPIC_LIFECYCLE,
            abi.encode(
                "Shutdown requested",
                "uptime_seconds",
                uptime,
                "events_processed",
                eventsProcessed
            )
        );
    }

    /// @notice Called on every step while in SHUTTING_DOWN state.
    /// @dev For this simple example, we complete immediately.
    ///      Real strategies might need multiple steps to close positions,
    ///      collect fees, or return funds.
    /// @return done True when cleanup is complete
    function onShutdownStep() internal override returns (bool done) {
        // Log cleanup progress
        _logDebug(
            TOPIC_SHUTDOWN_PROGRESS,
            abi.encode("Cleanup step executing")
        );

        // For this example, we complete immediately
        // Real strategies would track cleanup state and return false
        // until all cleanup tasks are complete
        return true;
    }

    /// @notice Called exactly once when shutdown completes.
    /// @dev Logs final statistics before the strategy enters SHUTDOWN state.
    function onShutdownComplete() internal override {
        uint256 finalUptime = block.timestamp - startedAt;

        _logInfo(
            TOPIC_LIFECYCLE,
            abi.encode(
                "Shutdown complete",
                "final_uptime_seconds",
                finalUptime,
                "total_events_processed",
                eventsProcessed
            )
        );
    }

    // =============================================================
    // Step Event Handler
    // =============================================================

    /// @notice Handle step events (lifecycle and other events).
    /// @dev Routes to LifecycleMixin for lifecycle events, processes others.
    ///      Demonstrates how to properly override _onStepEvent when using multiple mixins.
    /// @param eventType The type of event (e.g., STEP_EVENT_LIFECYCLE)
    /// @param eventVersion The version of the event envelope
    /// @param payload The encoded event data
    function _onStepEvent(
        bytes32 eventType,
        uint32 eventVersion,
        bytes memory payload
    ) internal override(LifecycleMixin, BaseStrategy) {
        // Let LifecycleMixin handle lifecycle events first
        if (eventType == STEP_EVENT_LIFECYCLE) {
            LifecycleMixin._onStepEvent(eventType, eventVersion, payload);
            return;
        }

        // Call parent for non-lifecycle events (handles shutdown progress)
        super._onStepEvent(eventType, eventVersion, payload);

        // Only process regular events if strategy is active
        if (!_isActive()) {
            return;
        }

        // Log that we received an event
        _logDebug(
            keccak256("EVENT_RECEIVED"),
            abi.encode(eventType, eventsProcessed + 1)
        );

        // Increment event counter
        eventsProcessed++;
    }
}
