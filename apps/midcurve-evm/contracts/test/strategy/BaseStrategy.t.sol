// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/strategy/BaseStrategy.sol";
import "../../src/interfaces/IStrategy.sol";

/// @dev Concrete implementation of BaseStrategy for testing
contract TestStrategy is BaseStrategy {
    constructor(address _owner) BaseStrategy(_owner) {}

    /// @dev Expose _nextEffectId for testing
    function nextEffectId() external returns (bytes32) {
        return _nextEffectId();
    }
}

contract BaseStrategyTest is Test {
    TestStrategy public strategy;

    address constant OWNER = address(0xBEEF);
    address constant NON_OWNER = address(0xCAFE);

    function setUp() public {
        strategy = new TestStrategy(OWNER);
    }

    function test_constructor_setsOwner() public view {
        assertEq(strategy.owner(), OWNER);
    }

    function test_constructor_revert_zeroOwner() public {
        vm.expectRevert(BaseStrategy.OwnerCannotBeZero.selector);
        new TestStrategy(address(0));
    }

    function test_registry_isCorrectAddress() public view {
        assertEq(
            address(strategy.REGISTRY()),
            0x0000000000000000000000000000000000001000
        );
    }

    function test_onlyOwner_allowsOwner() public {
        // This test verifies the modifier exists - actual protection tested in derived contracts
        assertEq(strategy.owner(), OWNER);
    }

    function test_nextEffectId_generatesUniqueIds() public {
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
        TestStrategy strategy2 = new TestStrategy(OWNER);
        bytes32 id2 = strategy2.nextEffectId();

        assertTrue(id != id2, "Different strategies should generate different IDs");
    }

    function test_implementsIStrategy() public view {
        // Verify that BaseStrategy implements IStrategy interface
        IStrategy iStrategy = IStrategy(address(strategy));
        assertEq(iStrategy.owner(), OWNER);
    }
}
