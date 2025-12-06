// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/strategy/BaseStrategy.sol";
import "../../src/interfaces/IStrategy.sol";

/// @dev Concrete implementation of BaseStrategy for testing
contract TestStrategy is BaseStrategy {
    bool public onStartCalled;
    bool public onShutdownCalled;

    constructor() BaseStrategy() {}

    /// @dev Expose _nextEffectId for testing
    function nextEffectId() external returns (bytes32) {
        return _nextEffectId();
    }

    function _onStart() internal override {
        onStartCalled = true;
    }

    function _onShutdown() internal override {
        onShutdownCalled = true;
    }
}

contract BaseStrategyTest is Test {
    TestStrategy public strategy;

    address constant NON_OWNER = address(0xCAFE);

    event StrategyStarted();
    event StrategyShutdown();

    function setUp() public {
        strategy = new TestStrategy();
    }

    // =========== Constructor Tests ===========

    function test_constructor_setsOwnerToDeployer() public view {
        assertEq(strategy.owner(), address(this));
    }

    function test_constructor_setsStateToCreated() public view {
        assertEq(uint256(strategy.state()), uint256(IStrategy.StrategyState.Created));
    }

    function test_registry_isCorrectAddress() public view {
        assertEq(
            address(strategy.REGISTRY()),
            0x0000000000000000000000000000000000001000
        );
    }

    // =========== Lifecycle Tests ===========

    function test_start_changesStateToRunning() public {
        strategy.start();
        assertEq(uint256(strategy.state()), uint256(IStrategy.StrategyState.Running));
    }

    function test_start_callsOnStartHook() public {
        assertFalse(strategy.onStartCalled());
        strategy.start();
        assertTrue(strategy.onStartCalled());
    }

    function test_start_emitsStrategyStartedEvent() public {
        vm.expectEmit(true, true, true, true);
        emit StrategyStarted();
        strategy.start();
    }

    function test_start_revertsIfNotOwner() public {
        vm.prank(NON_OWNER);
        vm.expectRevert(BaseStrategy.OnlyOwnerAllowed.selector);
        strategy.start();
    }

    function test_start_revertsIfAlreadyRunning() public {
        strategy.start();
        vm.expectRevert(
            abi.encodeWithSelector(
                BaseStrategy.InvalidState.selector,
                IStrategy.StrategyState.Running,
                IStrategy.StrategyState.Created
            )
        );
        strategy.start();
    }

    function test_start_revertsIfShutdown() public {
        strategy.start();
        strategy.shutdown();
        vm.expectRevert(
            abi.encodeWithSelector(
                BaseStrategy.InvalidState.selector,
                IStrategy.StrategyState.Shutdown,
                IStrategy.StrategyState.Created
            )
        );
        strategy.start();
    }

    function test_shutdown_changesStateToShutdown() public {
        strategy.start();
        strategy.shutdown();
        assertEq(uint256(strategy.state()), uint256(IStrategy.StrategyState.Shutdown));
    }

    function test_shutdown_callsOnShutdownHook() public {
        strategy.start();
        assertFalse(strategy.onShutdownCalled());
        strategy.shutdown();
        assertTrue(strategy.onShutdownCalled());
    }

    function test_shutdown_emitsStrategyShutdownEvent() public {
        strategy.start();
        vm.expectEmit(true, true, true, true);
        emit StrategyShutdown();
        strategy.shutdown();
    }

    function test_shutdown_revertsIfNotOwner() public {
        strategy.start();
        vm.prank(NON_OWNER);
        vm.expectRevert(BaseStrategy.OnlyOwnerAllowed.selector);
        strategy.shutdown();
    }

    function test_shutdown_revertsIfNotRunning() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                BaseStrategy.InvalidState.selector,
                IStrategy.StrategyState.Created,
                IStrategy.StrategyState.Running
            )
        );
        strategy.shutdown();
    }

    function test_shutdown_revertsIfAlreadyShutdown() public {
        strategy.start();
        strategy.shutdown();
        vm.expectRevert(
            abi.encodeWithSelector(
                BaseStrategy.InvalidState.selector,
                IStrategy.StrategyState.Shutdown,
                IStrategy.StrategyState.Running
            )
        );
        strategy.shutdown();
    }

    // =========== Effect ID Tests ===========

    function test_nextEffectId_generatesUniqueIds() public {
        strategy.start(); // Need to be running for most operations
        bytes32 id1 = strategy.nextEffectId();
        bytes32 id2 = strategy.nextEffectId();
        bytes32 id3 = strategy.nextEffectId();

        assertTrue(id1 != id2, "First two IDs should be different");
        assertTrue(id2 != id3, "Second and third IDs should be different");
        assertTrue(id1 != id3, "First and third IDs should be different");
    }

    function test_nextEffectId_includesContractAddress() public {
        bytes32 id = strategy.nextEffectId();

        // Create another strategy and verify different IDs
        TestStrategy strategy2 = new TestStrategy();
        bytes32 id2 = strategy2.nextEffectId();

        assertTrue(id != id2, "Different strategies should generate different IDs");
    }

    // =========== Interface Tests ===========

    function test_implementsIStrategy() public view {
        // Verify that BaseStrategy implements IStrategy interface
        IStrategy iStrategy = IStrategy(address(strategy));
        assertEq(iStrategy.owner(), address(this));
        assertEq(uint256(iStrategy.state()), uint256(IStrategy.StrategyState.Created));
    }
}
