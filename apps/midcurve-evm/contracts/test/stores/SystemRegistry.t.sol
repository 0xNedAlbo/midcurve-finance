// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/stores/SystemRegistry.sol";
import "../../src/libraries/CoreControlled.sol";

contract SystemRegistryTest is Test {
    SystemRegistry public registry;

    address constant CORE = 0x0000000000000000000000000000000000000001;
    address constant NON_CORE = address(0xBEEF);
    address constant POOL_STORE = address(0x1001);
    address constant POSITION_STORE = address(0x1002);
    address constant BALANCE_STORE = address(0x1003);
    address constant OHLC_STORE = address(0x1004);

    event PoolStoreUpdated(address indexed oldAddress, address indexed newAddress);
    event PositionStoreUpdated(address indexed oldAddress, address indexed newAddress);
    event BalanceStoreUpdated(address indexed oldAddress, address indexed newAddress);
    event OhlcStoreUpdated(address indexed oldAddress, address indexed newAddress);

    function setUp() public {
        registry = new SystemRegistry();
    }

    function test_initialState() public view {
        assertEq(registry.poolStore(), address(0));
        assertEq(registry.positionStore(), address(0));
        assertEq(registry.balanceStore(), address(0));
        assertEq(registry.ohlcStore(), address(0));
        assertEq(registry.CORE(), CORE);
    }

    function test_setPoolStore() public {
        vm.prank(CORE);
        vm.expectEmit(true, true, false, false);
        emit PoolStoreUpdated(address(0), POOL_STORE);
        registry.setPoolStore(POOL_STORE);

        assertEq(registry.poolStore(), POOL_STORE);
    }

    function test_setPositionStore() public {
        vm.prank(CORE);
        vm.expectEmit(true, true, false, false);
        emit PositionStoreUpdated(address(0), POSITION_STORE);
        registry.setPositionStore(POSITION_STORE);

        assertEq(registry.positionStore(), POSITION_STORE);
    }

    function test_setBalanceStore() public {
        vm.prank(CORE);
        vm.expectEmit(true, true, false, false);
        emit BalanceStoreUpdated(address(0), BALANCE_STORE);
        registry.setBalanceStore(BALANCE_STORE);

        assertEq(registry.balanceStore(), BALANCE_STORE);
    }

    function test_setOhlcStore() public {
        vm.prank(CORE);
        vm.expectEmit(true, true, false, false);
        emit OhlcStoreUpdated(address(0), OHLC_STORE);
        registry.setOhlcStore(OHLC_STORE);

        assertEq(registry.ohlcStore(), OHLC_STORE);
    }

    function test_revert_setPoolStore_notCore() public {
        vm.prank(NON_CORE);
        vm.expectRevert(CoreControlled.OnlyCoreAllowed.selector);
        registry.setPoolStore(POOL_STORE);
    }

    function test_revert_setPositionStore_notCore() public {
        vm.prank(NON_CORE);
        vm.expectRevert(CoreControlled.OnlyCoreAllowed.selector);
        registry.setPositionStore(POSITION_STORE);
    }

    function test_revert_setBalanceStore_notCore() public {
        vm.prank(NON_CORE);
        vm.expectRevert(CoreControlled.OnlyCoreAllowed.selector);
        registry.setBalanceStore(BALANCE_STORE);
    }

    function test_revert_setOhlcStore_notCore() public {
        vm.prank(NON_CORE);
        vm.expectRevert(CoreControlled.OnlyCoreAllowed.selector);
        registry.setOhlcStore(OHLC_STORE);
    }

    function test_updateStore() public {
        address newPoolStore = address(0x2001);

        vm.prank(CORE);
        registry.setPoolStore(POOL_STORE);

        vm.prank(CORE);
        vm.expectEmit(true, true, false, false);
        emit PoolStoreUpdated(POOL_STORE, newPoolStore);
        registry.setPoolStore(newPoolStore);

        assertEq(registry.poolStore(), newPoolStore);
    }
}
