// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/stores/PoolStore.sol";
import "../../src/interfaces/IPoolStore.sol";
import "../../src/libraries/CoreControlled.sol";

contract PoolStoreTest is Test {
    PoolStore public store;

    address constant CORE = 0x0000000000000000000000000000000000000001;
    address constant NON_CORE = address(0xBEEF);

    bytes32 constant POOL_ID = keccak256(abi.encodePacked(uint256(1), address(0xDEAD)));

    event PoolUpdated(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick);

    function setUp() public {
        store = new PoolStore();
    }

    function _createPoolState() internal view returns (IPoolStore.PoolState memory) {
        return IPoolStore.PoolState({
            chainId: 1,
            poolAddress: address(0xDEAD),
            token0: address(0x1111),
            token1: address(0x2222),
            fee: 3000,
            sqrtPriceX96: 79228162514264337593543950336, // ~1:1 price
            tick: 0,
            liquidity: 1000000000000000000,
            feeGrowthGlobal0X128: 0,
            feeGrowthGlobal1X128: 0,
            lastUpdated: block.timestamp
        });
    }

    function test_updatePool() public {
        IPoolStore.PoolState memory state = _createPoolState();

        vm.prank(CORE);
        vm.expectEmit(true, false, false, true);
        emit PoolUpdated(POOL_ID, state.sqrtPriceX96, state.tick);
        store.updatePool(POOL_ID, state);

        IPoolStore.PoolState memory retrieved = store.getPool(POOL_ID);
        assertEq(retrieved.chainId, state.chainId);
        assertEq(retrieved.poolAddress, state.poolAddress);
        assertEq(retrieved.token0, state.token0);
        assertEq(retrieved.token1, state.token1);
        assertEq(retrieved.fee, state.fee);
        assertEq(retrieved.sqrtPriceX96, state.sqrtPriceX96);
        assertEq(retrieved.tick, state.tick);
        assertEq(retrieved.liquidity, state.liquidity);
    }

    function test_getCurrentPrice() public {
        IPoolStore.PoolState memory state = _createPoolState();
        state.sqrtPriceX96 = 123456789;

        vm.prank(CORE);
        store.updatePool(POOL_ID, state);

        assertEq(store.getCurrentPrice(POOL_ID), 123456789);
    }

    function test_getCurrentTick() public {
        IPoolStore.PoolState memory state = _createPoolState();
        state.tick = -12345;

        vm.prank(CORE);
        store.updatePool(POOL_ID, state);

        assertEq(store.getCurrentTick(POOL_ID), -12345);
    }

    function test_revert_updatePool_notCore() public {
        IPoolStore.PoolState memory state = _createPoolState();

        vm.prank(NON_CORE);
        vm.expectRevert(CoreControlled.OnlyCoreAllowed.selector);
        store.updatePool(POOL_ID, state);
    }

    function test_getPool_nonExistent() public view {
        IPoolStore.PoolState memory state = store.getPool(POOL_ID);
        assertEq(state.chainId, 0);
        assertEq(state.poolAddress, address(0));
    }

    function test_updatePool_overwrite() public {
        IPoolStore.PoolState memory state1 = _createPoolState();
        state1.sqrtPriceX96 = 100;

        IPoolStore.PoolState memory state2 = _createPoolState();
        state2.sqrtPriceX96 = 200;

        vm.prank(CORE);
        store.updatePool(POOL_ID, state1);
        assertEq(store.getCurrentPrice(POOL_ID), 100);

        vm.prank(CORE);
        store.updatePool(POOL_ID, state2);
        assertEq(store.getCurrentPrice(POOL_ID), 200);
    }
}
