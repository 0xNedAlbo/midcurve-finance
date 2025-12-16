// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BaseStrategy } from "../strategy/BaseStrategy.sol";
import { LoggingMixin } from "../strategy/mixins/LoggingMixin.sol";

/// @notice Minimal strategy for POC - logs multiple messages on every step event.
/// This demonstrates the durable await pattern with multiple sequential effects.
contract SimpleLoggingStrategy is LoggingMixin {
    /// @dev Counter to track how many events we've processed
    uint256 public eventsProcessed;

    constructor(address operator_, address core_)
        BaseStrategy(operator_, core_) {}

    /// @dev Override the step event handler to log multiple messages.
    /// Each _log* call triggers a separate EffectNeeded revert during simulation.
    /// The durable await loop must handle each effect in sequence.
    function _onStepEvent(
        bytes32 eventType,
        uint32 eventVersion,
        bytes memory payload
    ) internal override {
        // Silence unused variable warnings
        eventVersion;
        payload;

        // Effect 1: Log that we received an event
        _logInfo(keccak256("STEP_START"), abi.encode(eventType));

        // Effect 2: Log the current epoch
        _logDebug(keccak256("EPOCH_INFO"), abi.encode(epoch()));

        // Effect 3: Log the events processed count (before incrementing)
        _logInfo(keccak256("EVENTS_COUNT"), abi.encode(eventsProcessed));

        // Increment counter (this state change only persists on final commit)
        eventsProcessed++;

        // Effect 4: Log completion
        _logInfo(keccak256("STEP_COMPLETE"), abi.encode(eventType));

        // Forward to base (no-op but good practice for mixin chain)
        super._onStepEvent(eventType, eventVersion, payload);
    }
}
