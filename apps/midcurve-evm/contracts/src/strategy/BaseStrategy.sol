// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IStrategy} from "../interfaces/IStrategy.sol";
import {ISystemRegistry} from "../interfaces/ISystemRegistry.sol";
import {LoggingLib} from "../libraries/LoggingLib.sol";

/**
 * @title BaseStrategy
 * @notice Minimal base contract for SEMSEE strategies
 * @dev Provides essential infrastructure:
 *      - Owner management (owner = msg.sender, the deployer)
 *      - Lifecycle management (Created -> Running -> Shutdown)
 *      - Effect ID generation for tracking async actions
 *      - Access to SystemRegistry
 *      - Logging via LoggingLib
 *
 * Strategies extend this and implement module interfaces:
 * - IOhlcConsumer for price data
 * - IPoolConsumer for pool state
 * - IBalanceConsumer for balance updates
 * - IUniswapV3Actions for position management
 * - IFundingActions for withdrawals
 *
 * Lifecycle:
 * 1. Deploy: Constructor runs, owner set to deployer, state = Created
 * 2. Start: Owner calls start(), _onStart() hook runs, state = Running
 * 3. Shutdown: Owner calls shutdown(), _onShutdown() hook runs, state = Shutdown
 */
contract BaseStrategy is IStrategy {
    using LoggingLib for *;

    // =========== System Constants ===========

    /// @notice The well-known address of the SystemRegistry
    ISystemRegistry public constant REGISTRY = ISystemRegistry(0x0000000000000000000000000000000000001000);

    // =========== Owner ===========

    /// @notice The owner address of this strategy (the deployer)
    address public immutable override owner;

    // =========== Lifecycle State ===========

    /// @notice Current lifecycle state
    StrategyState private _state;

    // =========== Effect Tracking ===========

    /// @dev Counter for generating unique effect IDs
    uint256 private _effectCounter;

    // =========== Errors ===========

    /// @notice Error thrown when a non-owner address attempts an owner-only operation
    error OnlyOwnerAllowed();

    /// @notice Error when operation not allowed in current state
    error InvalidState(StrategyState current, StrategyState required);

    // =========== Constructor ===========

    /**
     * @notice Initialize the strategy with the deployer as owner
     * @dev owner = msg.sender, no constructor arg needed
     */
    constructor() {
        owner = msg.sender;
        _state = StrategyState.Created;
    }

    // =========== Lifecycle ===========

    /// @notice Returns current state
    function state() external view override returns (StrategyState) {
        return _state;
    }

    /// @notice Modifier to restrict to owner
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwnerAllowed();
        _;
    }

    /// @notice Modifier to restrict to Running state
    modifier onlyRunning() {
        if (_state != StrategyState.Running) {
            revert InvalidState(_state, StrategyState.Running);
        }
        _;
    }

    /// @notice Start the strategy (only owner, only from Created state)
    function start() external virtual override onlyOwner {
        if (_state != StrategyState.Created) {
            revert InvalidState(_state, StrategyState.Created);
        }

        _state = StrategyState.Running;
        _onStart(); // Hook for subclasses
        emit StrategyStarted();
    }

    /// @notice Shutdown the strategy (only owner, only from Running state)
    function shutdown() external virtual override onlyOwner {
        if (_state != StrategyState.Running) {
            revert InvalidState(_state, StrategyState.Running);
        }

        _onShutdown(); // Hook for subclasses - unsubscribe here
        _state = StrategyState.Shutdown;
        emit StrategyShutdown();
    }

    /// @notice Hook called when strategy starts - override to set up subscriptions
    function _onStart() internal virtual {}

    /// @notice Hook called before shutdown - override to remove subscriptions
    function _onShutdown() internal virtual {}

    // =========== Effect ID Generation ===========

    /**
     * @notice Generate a unique effect ID for tracking async actions
     * @dev Effect IDs are used to correlate action requests with their results
     * @return A unique bytes32 identifier for the effect
     */
    function _nextEffectId() internal returns (bytes32) {
        _effectCounter++;
        return keccak256(abi.encodePacked(address(this), _effectCounter));
    }
}
