// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IStrategy} from "../interfaces/IStrategy.sol";
import {ISystemRegistry} from "../interfaces/ISystemRegistry.sol";
import {LoggingLib} from "../libraries/LoggingLib.sol";

/**
 * @title BaseStrategy
 * @notice Minimal base contract for SEMSEE strategies
 * @dev Provides essential infrastructure:
 *      - Owner management with onlyOwner modifier
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
 */
contract BaseStrategy is IStrategy {
    using LoggingLib for *;

    // =========== System Constants ===========

    /// @notice The well-known address of the SystemRegistry
    ISystemRegistry public constant REGISTRY = ISystemRegistry(0x0000000000000000000000000000000000001000);

    // =========== Owner ===========

    /// @notice The owner address of this strategy (typically an automation wallet)
    address public immutable override owner;

    // =========== Effect Tracking ===========

    /// @dev Counter for generating unique effect IDs
    uint256 private _effectCounter;

    // =========== Errors ===========

    /// @notice Error thrown when a non-owner address attempts an owner-only operation
    error OnlyOwnerAllowed();

    /// @notice Error thrown when owner address is zero
    error OwnerCannotBeZero();

    // =========== Constructor ===========

    /**
     * @notice Initialize the strategy with an owner
     * @param _owner The address that will own this strategy
     */
    constructor(address _owner) {
        if (_owner == address(0)) revert OwnerCannotBeZero();
        owner = _owner;
    }

    // =========== Modifiers ===========

    /**
     * @notice Restricts function access to the strategy owner
     * @dev Used for user actions like parameter changes and manual triggers
     */
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwnerAllowed();
        _;
    }

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
