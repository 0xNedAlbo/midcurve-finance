// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseStrategy } from "../strategy/BaseStrategy.sol";
import { LifecycleMixin } from "../strategy/mixins/LifecycleMixin.sol";
import { LoggingMixin } from "../strategy/mixins/LoggingMixin.sol";

/// @notice Minimal strategy for POC - logs multiple messages on every step event.
/// This demonstrates the durable await pattern with multiple sequential effects.
///
/// Inheritance order: LifecycleMixin, LoggingMixin
/// - LifecycleMixin handles STEP_EVENT_LIFECYCLE (START/SHUTDOWN)
/// - LoggingMixin provides _log* helpers
/// - Both extend BaseStrategy
///
/// Log topics used:
/// - LIFECYCLE: Lifecycle state changes (canonical - no manifest declaration needed)
/// - CUSTOM_STEP_START: Step event started processing (custom - must declare in manifest)
/// - CUSTOM_EPOCH_INFO: Current epoch information (custom - must declare in manifest)
/// - CUSTOM_EVENTS_COUNT: Events processed counter (custom - must declare in manifest)
/// - CUSTOM_STEP_COMPLETE: Step event processing complete (custom - must declare in manifest)
contract SimpleLoggingStrategy is LifecycleMixin, LoggingMixin {
    /// @dev Counter to track how many events we've processed
    uint256 public eventsProcessed;

    constructor(address operator_, address core_)
        BaseStrategy(operator_, core_) {}

    // =============================================================
    // Lifecycle Hooks
    // =============================================================

    /// @dev Called when strategy receives START command.
    function onStart() internal override {
        _logInfo(keccak256("LIFECYCLE"), "Strategy started");
    }

    /// @dev Called when strategy receives SHUTDOWN command.
    function onShutdownRequested() internal override {
        _logInfo(keccak256("LIFECYCLE"), "Shutdown requested");
    }

    /// @dev Called when shutdown is complete.
    function onShutdownComplete() internal override {
        _logInfo(keccak256("LIFECYCLE"), "Shutdown complete");
    }

    // =============================================================
    // Step Event Handler
    // =============================================================

    /// @dev Override the step event handler to log multiple messages.
    /// Each _log* call triggers a separate EffectNeeded revert during simulation.
    /// The durable await loop must handle each effect in sequence.
    function _onStepEvent(
        bytes32 eventType,
        uint32 eventVersion,
        bytes memory payload
    ) internal override(LifecycleMixin, BaseStrategy) {
        // Check if this is a lifecycle event - LifecycleMixin will handle and return
        if (eventType == STEP_EVENT_LIFECYCLE) {
            LifecycleMixin._onStepEvent(eventType, eventVersion, payload);
            return;
        }

        // For non-lifecycle events, call parent to handle shutdown progress
        super._onStepEvent(eventType, eventVersion, payload);

        // Only process events if strategy is active
        if (!_isActive()) {
            return;
        }

        // Effect 1: Log that we received an event
        _logInfo(keccak256("CUSTOM_STEP_START"), "Processing step event");

        // Effect 2: Log the current epoch
        _logDebug(keccak256("CUSTOM_EPOCH_INFO"), "Epoch check completed");

        // Effect 3: Log the events processed count (before incrementing)
        _logInfo(keccak256("CUSTOM_EVENTS_COUNT"), "Incrementing events counter");

        // Increment counter (this state change only persists on final commit)
        eventsProcessed++;

        // Effect 4: Log completion
        _logInfo(keccak256("CUSTOM_STEP_COMPLETE"), "Step event processing complete");
    }
}
