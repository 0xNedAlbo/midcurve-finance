// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/stores/BalanceStore.sol";
import "../../src/interfaces/IBalanceStore.sol";
import "../../src/libraries/CoreControlled.sol";

contract BalanceStoreTest is Test {
    BalanceStore public store;

    address constant CORE = 0x0000000000000000000000000000000000000001;
    address constant NON_CORE = address(0xBEEF);
    address constant STRATEGY = address(0xCAFE);
    address constant OTHER_STRATEGY = address(0xFACE);
    address constant TOKEN_A = address(0x1111);
    address constant TOKEN_B = address(0x2222);
    uint256 constant CHAIN_ID = 1;

    event BalanceUpdated(
        address indexed strategy,
        uint256 indexed chainId,
        address indexed token,
        uint256 balance
    );

    function setUp() public {
        store = new BalanceStore();
    }

    function test_updateBalance() public {
        vm.prank(CORE);
        vm.expectEmit(true, true, true, true);
        emit BalanceUpdated(STRATEGY, CHAIN_ID, TOKEN_A, 1000);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 1000);

        vm.prank(STRATEGY);
        assertEq(store.getBalance(CHAIN_ID, TOKEN_A), 1000);
    }

    function test_getBalance_ownOnly() public {
        vm.prank(CORE);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 1000);

        // Owner can read
        vm.prank(STRATEGY);
        assertEq(store.getBalance(CHAIN_ID, TOKEN_A), 1000);

        // Other strategy sees 0 (reads from their own mapping)
        vm.prank(OTHER_STRATEGY);
        assertEq(store.getBalance(CHAIN_ID, TOKEN_A), 0);
    }

    function test_getAllBalances() public {
        vm.startPrank(CORE);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 1000);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_B, 2000);
        vm.stopPrank();

        vm.prank(STRATEGY);
        IBalanceStore.BalanceEntry[] memory entries = store.getAllBalances(CHAIN_ID);

        assertEq(entries.length, 2);
        assertEq(entries[0].token, TOKEN_A);
        assertEq(entries[0].balance, 1000);
        assertEq(entries[1].token, TOKEN_B);
        assertEq(entries[1].balance, 2000);
    }

    function test_getAllBalances_ownOnly() public {
        vm.prank(CORE);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 1000);

        // Other strategy sees empty array
        vm.prank(OTHER_STRATEGY);
        IBalanceStore.BalanceEntry[] memory entries = store.getAllBalances(CHAIN_ID);
        assertEq(entries.length, 0);
    }

    function test_revert_updateBalance_notCore() public {
        vm.prank(NON_CORE);
        vm.expectRevert(CoreControlled.OnlyCoreAllowed.selector);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 1000);
    }

    function test_updateBalance_overwrite() public {
        vm.prank(CORE);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 1000);

        vm.prank(STRATEGY);
        assertEq(store.getBalance(CHAIN_ID, TOKEN_A), 1000);

        vm.prank(CORE);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 2000);

        vm.prank(STRATEGY);
        assertEq(store.getBalance(CHAIN_ID, TOKEN_A), 2000);
    }

    function test_updateBalance_noDuplicateTokenInList() public {
        vm.startPrank(CORE);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 1000);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 2000);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 3000);
        vm.stopPrank();

        vm.prank(STRATEGY);
        IBalanceStore.BalanceEntry[] memory entries = store.getAllBalances(CHAIN_ID);

        // Should only have 1 entry, not 3
        assertEq(entries.length, 1);
        assertEq(entries[0].balance, 3000);
    }

    function test_multipleChains() public {
        uint256 chainId2 = 137; // Polygon

        vm.startPrank(CORE);
        store.updateBalance(STRATEGY, CHAIN_ID, TOKEN_A, 1000);
        store.updateBalance(STRATEGY, chainId2, TOKEN_A, 5000);
        vm.stopPrank();

        vm.startPrank(STRATEGY);
        assertEq(store.getBalance(CHAIN_ID, TOKEN_A), 1000);
        assertEq(store.getBalance(chainId2, TOKEN_A), 5000);
        vm.stopPrank();
    }
}
