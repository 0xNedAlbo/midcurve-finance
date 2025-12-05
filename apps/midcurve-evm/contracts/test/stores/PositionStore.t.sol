// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/stores/PositionStore.sol";
import "../../src/interfaces/IPositionStore.sol";
import "../../src/libraries/CoreControlled.sol";

contract PositionStoreTest is Test {
    PositionStore public store;

    address constant CORE = 0x0000000000000000000000000000000000000001;
    address constant NON_CORE = address(0xBEEF);
    address constant STRATEGY_OWNER = address(0xCAFE);
    address constant OTHER_STRATEGY = address(0xFACE);

    bytes32 constant POSITION_ID = keccak256(abi.encodePacked(uint256(1), uint256(12345)));
    bytes32 constant POOL_ID = keccak256(abi.encodePacked(uint256(1), address(0xDEAD)));

    event PositionUpdated(bytes32 indexed positionId, address indexed owner, uint128 liquidity);

    function setUp() public {
        store = new PositionStore();
    }

    function _createPositionState(address owner) internal view returns (IPositionStore.PositionState memory) {
        return IPositionStore.PositionState({
            chainId: 1,
            nftTokenId: 12345,
            poolId: POOL_ID,
            owner: owner,
            tickLower: -887220,
            tickUpper: 887220,
            liquidity: 1000000000000000000,
            feeGrowthInside0LastX128: 0,
            feeGrowthInside1LastX128: 0,
            tokensOwed0: 0,
            tokensOwed1: 0,
            lastUpdated: block.timestamp
        });
    }

    function test_updatePosition() public {
        IPositionStore.PositionState memory state = _createPositionState(STRATEGY_OWNER);

        vm.prank(CORE);
        vm.expectEmit(true, true, false, true);
        emit PositionUpdated(POSITION_ID, STRATEGY_OWNER, state.liquidity);
        store.updatePosition(POSITION_ID, state);

        // Owner can read
        vm.prank(STRATEGY_OWNER);
        IPositionStore.PositionState memory retrieved = store.getPosition(POSITION_ID);
        assertEq(retrieved.chainId, state.chainId);
        assertEq(retrieved.nftTokenId, state.nftTokenId);
        assertEq(retrieved.owner, STRATEGY_OWNER);
        assertEq(retrieved.tickLower, state.tickLower);
        assertEq(retrieved.tickUpper, state.tickUpper);
        assertEq(retrieved.liquidity, state.liquidity);
    }

    function test_isOwner() public {
        IPositionStore.PositionState memory state = _createPositionState(STRATEGY_OWNER);

        vm.prank(CORE);
        store.updatePosition(POSITION_ID, state);

        assertTrue(store.isOwner(POSITION_ID, STRATEGY_OWNER));
        assertFalse(store.isOwner(POSITION_ID, OTHER_STRATEGY));
        assertFalse(store.isOwner(POSITION_ID, CORE));
    }

    function test_revert_getPosition_notOwner() public {
        IPositionStore.PositionState memory state = _createPositionState(STRATEGY_OWNER);

        vm.prank(CORE);
        store.updatePosition(POSITION_ID, state);

        // Non-owner cannot read
        vm.prank(OTHER_STRATEGY);
        vm.expectRevert(IPositionStore.NotPositionOwner.selector);
        store.getPosition(POSITION_ID);
    }

    function test_revert_updatePosition_notCore() public {
        IPositionStore.PositionState memory state = _createPositionState(STRATEGY_OWNER);

        vm.prank(NON_CORE);
        vm.expectRevert(CoreControlled.OnlyCoreAllowed.selector);
        store.updatePosition(POSITION_ID, state);
    }

    function test_updatePosition_changeOwner() public {
        IPositionStore.PositionState memory state1 = _createPositionState(STRATEGY_OWNER);
        IPositionStore.PositionState memory state2 = _createPositionState(OTHER_STRATEGY);

        vm.prank(CORE);
        store.updatePosition(POSITION_ID, state1);

        assertTrue(store.isOwner(POSITION_ID, STRATEGY_OWNER));

        vm.prank(CORE);
        store.updatePosition(POSITION_ID, state2);

        assertFalse(store.isOwner(POSITION_ID, STRATEGY_OWNER));
        assertTrue(store.isOwner(POSITION_ID, OTHER_STRATEGY));
    }

    function test_getPosition_nonExistent() public {
        // Non-existent position has owner = address(0)
        // Any non-zero caller will get NotPositionOwner
        vm.prank(STRATEGY_OWNER);
        vm.expectRevert(IPositionStore.NotPositionOwner.selector);
        store.getPosition(POSITION_ID);
    }
}
